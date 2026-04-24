import {
  Injectable,
  NotFoundException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVerificationDto } from './dto/create-verification.dto';
import {
  VerificationJobData,
  VerificationResult,
} from './interfaces/verification-job.interface';
import { AuditService } from '../audit/audit.service';
import { Prisma } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// OCR service types
// ---------------------------------------------------------------------------

interface OCRFieldResult {
  value: string;
  confidence: number;
}

interface OCRResponse {
  success: boolean;
  data?: {
    fields: Record<string, OCRFieldResult>;
    raw_text: string;
    processing_time_ms: number;
  };
  error?: Record<string, string>;
  processing_time_ms: number;
}

// ---------------------------------------------------------------------------
// Internal claim shape used by verification logic
// ---------------------------------------------------------------------------

interface Claim {
  id: string;
  status: string;
  campaignId: string;
  amount: unknown;
  recipientRef: string;
  evidenceRef?: string | null;
}

// ---------------------------------------------------------------------------
// Structured JSON that the AI model must return
// ---------------------------------------------------------------------------

interface AIVerificationResponse {
  score: number; // 0–1 normalised legitimacy score
  confidence: number; // 0–1 model confidence
  riskLevel: 'low' | 'medium' | 'high';
  factors: string[]; // positive verification signals
  riskFactors: string[]; // identified concerns / red-flags
  recommendations: string[]; // next steps if human review needed
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);
  private readonly verificationMode: string;
  private readonly verificationThreshold: number;
  private readonly aiServiceUrl: string;
  private readonly aiServiceTimeout: number;
  private readonly openaiModel: string;
  private readonly openai: OpenAI | null;

  constructor(
    @InjectQueue('verification') private verificationQueue: Queue,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly httpService: HttpService,
  ) {
    this.verificationMode =
      this.configService.get<string>('VERIFICATION_MODE') || 'mock';
    this.verificationThreshold =
      parseFloat(
        this.configService.get<string>('VERIFICATION_THRESHOLD') || '0.7',
      ) || 0.7;
    this.aiServiceUrl =
      this.configService.get<string>('AI_SERVICE_URL') ||
      'http://localhost:8000';
    this.aiServiceTimeout = parseInt(
      this.configService.get<string>('AI_SERVICE_TIMEOUT_MS') || '30000',
      10,
    );
    this.openaiModel =
      this.configService.get<string>('OPENAI_MODEL') || 'gpt-4o-mini';

    // Initialise OpenAI client only when a key is present.
    // A missing key is not fatal – the fallback path handles it gracefully.
    const openAIKey = this.configService.get<string>('OPENAI_API_KEY');
    if (openAIKey) {
      this.openai = new OpenAI({ apiKey: openAIKey });
      this.logger.log(`OpenAI client initialised (model: ${this.openaiModel})`);
    } else {
      this.openai = null;
      this.logger.warn(
        'OPENAI_API_KEY not set – AI verification will fall back to mock scoring',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async enqueueVerification(claimId: string): Promise<{ jobId: string }> {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
    });

    if (!claim) {
      throw new NotFoundException(`Claim with ID ${claimId} not found`);
    }

    if (claim.status === 'verified') {
      this.logger.warn(`Claim ${claimId} is already verified`);
      return { jobId: 'already-verified' };
    }

    const jobData: VerificationJobData = {
      claimId,
      timestamp: Date.now(),
    };

    const job = await this.verificationQueue.add('verify-claim', jobData, {
      attempts: parseInt(
        this.configService.get<string>('QUEUE_MAX_RETRIES') || '3',
      ),
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 100,
      removeOnFail: 50,
    });

    this.logger.log(`Enqueued verification job ${job.id} for claim ${claimId}`);

    await this.auditService.record({
      actorId: 'system',
      entity: 'verification',
      entityId: claimId,
      action: 'enqueue',
      metadata: { jobId: job.id || 'unknown' },
    });

    return { jobId: job.id || 'unknown' };
  }

  async processVerification(
    jobData: VerificationJobData,
  ): Promise<VerificationResult> {
    const { claimId } = jobData;

    this.logger.log(
      `Processing verification for claim ${claimId} in ${this.verificationMode} mode`,
    );

    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
    });

    if (!claim) {
      throw new NotFoundException(`Claim with ID ${claimId} not found`);
    }

    let result: VerificationResult;

    if (this.verificationMode === 'mock') {
      result = this.generateMockVerification(claim);
    } else {
      result = await this.performAIVerification(claim);
    }

    const shouldVerify = result.score >= this.verificationThreshold;

    await this.prisma.claim.update({
      where: { id: claimId },
      data: {
        status: shouldVerify ? 'verified' : 'requested',
      },
    });

    // Create or update a review case for claims that were not auto-verified
    if (!shouldVerify) {
      await this.prisma.reviewCase.upsert({
        where: { claimId },
        update: {
          aiScore: result.score,
          confidence: result.confidence,
          riskLevel: result.details.riskLevel,
          factors: result.details.factors as unknown as Prisma.InputJsonValue,
          recommendations: (result.details.recommendations ?? []) as unknown as Prisma.InputJsonValue,
          evidenceSummary: claim.evidenceRef ?? undefined,
          status: 'pending',
        },
        create: {
          claimId,
          aiScore: result.score,
          confidence: result.confidence,
          riskLevel: result.details.riskLevel,
          factors: result.details.factors as unknown as Prisma.InputJsonValue,
          recommendations: (result.details.recommendations ?? []) as unknown as Prisma.InputJsonValue,
          evidenceSummary: claim.evidenceRef ?? undefined,
        },
      });
      this.logger.log(`Review case created/updated for claim ${claimId}`);
    } else {
      // If claim was auto-verified, remove any pending review case
      await this.prisma.reviewCase
        .deleteMany({ where: { claimId } })
        .catch(() => {
          // Ignore errors if no review case existed
        });
    }

    this.logger.log(
      `Claim ${claimId} verification completed – score ${result.score} ` +
        `(threshold: ${this.verificationThreshold})`,
    );

    await this.auditService.record({
      actorId: 'system',
      entity: 'verification',
      entityId: claimId,
      action: 'complete',
      metadata: {
        score: result.score,
        status: shouldVerify ? 'verified' : 'requested',
      },
    });

    return result;
  }

  // -------------------------------------------------------------------------
  // Core AI verification pipeline
  // -------------------------------------------------------------------------

  /**
   * Orchestrates the full AI-driven verification flow:
   *
   * 1. If `evidenceRef` looks like a URL, attempt OCR to extract document
   *    fields from the image/PDF, then pass the extracted text to OpenAI.
   * 2. If `evidenceRef` is a plain-text description of need, pass it directly
   *    to OpenAI (no OCR step needed).
   * 3. OpenAI analyses the evidence against humanitarian standards and returns
   *    a structured JSON verdict.
   * 4. If OpenAI is unavailable or returns an unparseable response, the method
   *    falls back to a deterministic mock result rather than throwing, so the
   *    queue job never fails silently.
   */
  private async performAIVerification(
    claim: Claim,
  ): Promise<VerificationResult> {
    this.logger.log(`Starting AI verification for claim ${claim.id}`);

    if (!claim.evidenceRef) {
      this.logger.warn(
        `Claim ${claim.id} has no evidenceRef – applying conservative mock score`,
      );
      return this.buildFallbackResult(
        'No evidence provided for this claim. Manual review is required.',
      );
    }

    // ------------------------------------------------------------------
    // Step 1 – Gather evidence context
    // ------------------------------------------------------------------
    let evidenceContext: string;

    if (this.looksLikeUrl(claim.evidenceRef)) {
      // Try OCR; on failure fall back to using the URL as-is in the prompt
      evidenceContext = await this.buildOCRContext(claim);
    } else {
      // evidenceRef is a free-text description of need – use it directly
      evidenceContext = `Applicant's stated need:\n${claim.evidenceRef}`;
    }

    // ------------------------------------------------------------------
    // Step 2 – Call OpenAI for semantic analysis
    // ------------------------------------------------------------------
    if (!this.openai) {
      this.logger.warn(
        `OpenAI client not available – falling back to mock for claim ${claim.id}`,
      );
      return this.buildFallbackResult(
        'AI service not configured. Fallback scoring applied.',
      );
    }

    try {
      const aiResult = await this.callOpenAI(claim, evidenceContext);
      return this.mapAIResponseToResult(aiResult);
    } catch (err) {
      // AI service unavailable or returned a bad response – degrade gracefully
      this.logger.error(
        `OpenAI call failed for claim ${claim.id}: ${(err as Error).message}. ` +
          `Falling back to mock result.`,
      );
      return this.buildFallbackResult(
        'AI analysis could not be completed. Manual review is required.',
      );
    }
  }

  // -------------------------------------------------------------------------
  // OpenAI interaction
  // -------------------------------------------------------------------------

  /**
   * Builds a system + user prompt pair grounded in humanitarian standards
   * (SPHERE Handbook, ICRC principles of humanity, impartiality, and
   * proportionality) and calls the OpenAI chat completions endpoint.
   *
   * The model is instructed to respond with a single JSON object only –
   * no markdown fences, no explanatory prose.
   */
  private async callOpenAI(
    claim: Claim,
    evidenceContext: string,
  ): Promise<AIVerificationResponse> {
    const systemPrompt = `
You are an impartial humanitarian aid verification analyst. Your role is to assess
whether an aid claim is legitimate and the stated need is proportionate.

You MUST apply the following humanitarian principles in every assessment:
• HUMANITY  – prioritise reducing suffering; give benefit of the doubt where evidence
  is limited but plausible.
• IMPARTIALITY – base the score solely on evidence and documented need, not on the
  identity, nationality, religion, or ethnicity of the applicant.
• PROPORTIONALITY – the requested aid amount must be proportionate to the documented
  need (e.g., household size, severity of crisis, local cost-of-living).
• NEUTRALITY – do not take sides; flag political affiliation only if it constitutes
  verifiable fraud.

Scoring rubric (score field, 0–1):
  0.85–1.00  Strong evidence, low risk, aid is proportionate.
  0.70–0.84  Reasonable evidence, minor gaps, likely legitimate.
  0.50–0.69  Insufficient or inconsistent evidence, manual review required.
  0.00–0.49  Significant red flags or clear inconsistencies detected.

confidence field (0–1): reflect how certain you are given the available evidence.
Lower confidence when evidence is sparse, not when the claim seems unlikely.

You MUST respond with valid JSON only – no markdown, no prose, no backticks.
The JSON object must have exactly these keys:
{
  "score": <number 0–1>,
  "confidence": <number 0–1>,
  "riskLevel": <"low"|"medium"|"high">,
  "factors": [<string>, ...],
  "riskFactors": [<string>, ...],
  "recommendations": [<string>, ...]
}
`.trim();

    const userPrompt = `
Claim metadata:
- Claim ID      : ${claim.id}
- Campaign ID   : ${claim.campaignId}
- Requested amt : ${String(claim.amount)}
- Recipient ref : ${claim.recipientRef}

Evidence:
${evidenceContext}

Assess this claim according to the humanitarian standards above and return only
the JSON verdict.
`.trim();

    this.logger.log(
      `Calling OpenAI (${this.openaiModel}) for claim ${claim.id}`,
    );

    const response = await this.openai!.chat.completions.create({
      model: this.openaiModel,
      temperature: 0, // deterministic scoring
      max_tokens: 512,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const rawContent = response.choices[0]?.message?.content ?? '';

    let parsed: AIVerificationResponse;
    try {
      parsed = JSON.parse(rawContent) as AIVerificationResponse;
    } catch {
      throw new Error(
        `OpenAI returned non-JSON content: ${rawContent.slice(0, 200)}`,
      );
    }

    this.validateAIResponse(parsed, claim.id);

    this.logger.log(
      `OpenAI verdict for claim ${claim.id}: ` +
        `score=${parsed.score}, confidence=${parsed.confidence}, ` +
        `riskLevel=${parsed.riskLevel}`,
    );

    return parsed;
  }

  /**
   * Validates that the AI response contains all required fields and that
   * numeric values are within the expected 0–1 range.  Throws on structural
   * issues so the caller can trigger the fallback path.
   */
  private validateAIResponse(
    resp: AIVerificationResponse,
    claimId: string,
  ): void {
    const requiredKeys: (keyof AIVerificationResponse)[] = [
      'score',
      'confidence',
      'riskLevel',
      'factors',
      'riskFactors',
      'recommendations',
    ];
    for (const key of requiredKeys) {
      if (resp[key] === undefined || resp[key] === null) {
        throw new Error(
          `AI response for claim ${claimId} is missing field "${key}"`,
        );
      }
    }

    if (resp.score < 0 || resp.score > 1) {
      throw new Error(
        `AI score out of range for claim ${claimId}: ${resp.score}`,
      );
    }
    if (resp.confidence < 0 || resp.confidence > 1) {
      throw new Error(
        `AI confidence out of range for claim ${claimId}: ${resp.confidence}`,
      );
    }
    if (!['low', 'medium', 'high'].includes(resp.riskLevel)) {
      throw new Error(
        `AI riskLevel invalid for claim ${claimId}: ${resp.riskLevel}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // OCR helpers
  // -------------------------------------------------------------------------

  /**
   * Calls the Python OCR micro-service and converts the response into a
   * human-readable evidence context string suitable for the AI prompt.
   * Falls back to a minimal context string if OCR fails, rather than
   * throwing – the AI layer will then assign lower confidence accordingly.
   */
  private async buildOCRContext(claim: Claim): Promise<string> {
    try {
      const ocrResponse = await this.callOCRService(claim.evidenceRef!);

      if (!ocrResponse.success || !ocrResponse.data) {
        this.logger.warn(
          `OCR failed for claim ${claim.id}: ` +
            `${JSON.stringify(ocrResponse.error)} – continuing with URL only`,
        );
        return `Document URL (OCR failed): ${claim.evidenceRef}`;
      }

      const { fields, raw_text } = ocrResponse.data;

      const fieldLines = Object.entries(fields)
        .filter(([, v]) => v.value)
        .map(
          ([k, v]) =>
            `  ${k.replace(/_/g, ' ')}: "${v.value}" (confidence: ${(v.confidence * 100).toFixed(1)}%)`,
        )
        .join('\n');

      return [
        'Identity document – extracted fields:',
        fieldLines || '  (no structured fields extracted)',
        '',
        'Full OCR text:',
        raw_text || '  (no raw text extracted)',
      ].join('\n');
    } catch (err) {
      this.logger.warn(
        `OCR service unavailable for claim ${claim.id}: ` +
          `${(err as Error).message} – continuing without OCR data`,
      );
      return `Document URL (OCR service unreachable): ${claim.evidenceRef}`;
    }
  }

  private async callOCRService(documentUrl: string): Promise<OCRResponse> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.aiServiceUrl}/ai/ocr`,
          { document_url: documentUrl },
          {
            timeout: this.aiServiceTimeout,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );
      return response.data as OCRResponse;
    } catch (error) {
      const err = error as {
        response?: { status: number; data: unknown };
        code?: string;
        message: string;
      };
      if (err.response) {
        throw new Error(
          `OCR service returned ${err.response.status}: ` +
            `${JSON.stringify(err.response.data)}`,
        );
      } else if (err.code === 'ECONNREFUSED') {
        throw new Error(
          `OCR service unavailable at ${this.aiServiceUrl}. ` +
            `Is the Python ai-service running?`,
        );
      } else {
        throw new Error(`OCR service call failed: ${err.message}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Result builders
  // -------------------------------------------------------------------------

  private mapAIResponseToResult(
    ai: AIVerificationResponse,
  ): VerificationResult {
    return {
      score: parseFloat(ai.score.toFixed(3)),
      confidence: parseFloat(ai.confidence.toFixed(3)),
      details: {
        factors: [...ai.factors, ...ai.riskFactors],
        riskLevel: ai.riskLevel,
        recommendations:
          ai.recommendations.length > 0 ? ai.recommendations : undefined,
      },
      processedAt: new Date(),
    };
  }

  /**
   * Conservative fallback result used when the AI service is unavailable or
   * returns an invalid response.  Score is set just below the default 0.7
   * threshold so the claim lands in manual review rather than being
   * auto-approved or auto-rejected.
   */
  private buildFallbackResult(reason: string): VerificationResult {
    return {
      score: 0.55,
      confidence: 0.4,
      details: {
        factors: [reason],
        riskLevel: 'medium',
        recommendations: [
          'AI verification unavailable – manual review required',
          'Verify applicant identity and evidence independently',
        ],
      },
      processedAt: new Date(),
    };
  }

  /** Heuristic: treat strings that start with http/https as URLs. */
  private looksLikeUrl(value: string): boolean {
    return /^https?:\/\//i.test(value.trim());
  }

  // -------------------------------------------------------------------------
  // Mock (development / test)
  // -------------------------------------------------------------------------

  private generateMockVerification(_claim: unknown): VerificationResult {
    const baseScore = 0.6 + Math.random() * 0.35;
    const score = Math.min(0.95, Math.max(0.5, baseScore));

    const factors = [
      'Document authenticity verified',
      'Identity cross-reference passed',
      'Historical data consistent',
      'No fraud indicators detected',
    ];

    const riskLevel: 'low' | 'medium' | 'high' =
      score >= 0.8 ? 'low' : score >= 0.65 ? 'medium' : 'high';

    return {
      score: parseFloat(score.toFixed(3)),
      confidence: parseFloat((0.85 + Math.random() * 0.1).toFixed(3)),
      details: {
        factors: factors.slice(0, Math.floor(Math.random() * 2) + 2),
        riskLevel,
        recommendations:
          riskLevel !== 'low'
            ? [
                'Manual review recommended',
                'Additional documentation may be required',
              ]
            : undefined,
      },
      processedAt: new Date(),
    };
  }

  // -------------------------------------------------------------------------
  // CRUD / queue utilities (unchanged)
  // -------------------------------------------------------------------------

  create(_createVerificationDto: CreateVerificationDto) {
    return 'This action adds a new verification';
  }

  async findAll() {
    return Promise.resolve([]);
  }

  async findOne(id: string) {
    const claim = await this.prisma.claim.findUnique({ where: { id } });
    if (!claim) {
      throw new NotFoundException(`Claim with ID ${id} not found`);
    }
    return claim;
  }

  async findByUser(_userId: string) {
    return Promise.resolve([]);
  }

  async update(id: string, updateVerificationDto: Record<string, unknown>) {
    await this.auditService.record({
      actorId: 'system',
      entity: 'verification',
      entityId: id,
      action: 'update',
      metadata: updateVerificationDto,
    });
    return { id, message: 'Verification updated' };
  }

  async remove(id: string) {
    return Promise.resolve({ id, message: 'Removed' });
  }

  async getQueueMetrics() {
    const [waiting, active, completed, failed] = await Promise.all([
      this.verificationQueue.getWaitingCount(),
      this.verificationQueue.getActiveCount(),
      this.verificationQueue.getCompletedCount(),
      this.verificationQueue.getFailedCount(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      total: waiting + active + completed + failed,
    };
  }

  // -------------------------------------------------------------------------
  // Review queue
  // -------------------------------------------------------------------------

  async getReviewQueue(query: {
    status?: string;
    riskLevel?: string;
    fromDate?: string;
    toDate?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: Prisma.ReviewCaseWhereInput = {};

    if (query.status) {
      where.status = query.status as Prisma.EnumReviewCaseStatusFilter;
    }
    if (query.riskLevel) {
      where.riskLevel = query.riskLevel;
    }
    if (query.fromDate || query.toDate) {
      where.createdAt = {};
      if (query.fromDate) where.createdAt.gte = new Date(query.fromDate);
      if (query.toDate) where.createdAt.lte = new Date(query.toDate);
    }

    const [items, total] = await Promise.all([
      this.prisma.reviewCase.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          claim: {
            select: {
              id: true,
              status: true,
              amount: true,
              recipientRef: true,
              evidenceRef: true,
              createdAt: true,
              campaign: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.reviewCase.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async getReviewCase(id: string) {
    const reviewCase = await this.prisma.reviewCase.findUnique({
      where: { id },
      include: {
        claim: {
          select: {
            id: true,
            status: true,
            amount: true,
            recipientRef: true,
            evidenceRef: true,
            createdAt: true,
            campaign: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!reviewCase) {
      throw new NotFoundException(`Review case with ID ${id} not found`);
    }

    const [claimHistory, caseHistory] = await Promise.all([
      this.auditService.findLogs({ entityId: reviewCase.claimId }),
      this.auditService.findLogs({ entityId: reviewCase.id }),
    ]);

    const history = [...claimHistory, ...caseHistory].sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
    );

    return { ...reviewCase, history };
  }

  async approveReviewCase(
    id: string,
    reviewerId: string,
    notes?: string,
  ) {
    const reviewCase = await this.prisma.reviewCase.findUnique({
      where: { id },
    });

    if (!reviewCase) {
      throw new NotFoundException(`Review case with ID ${id} not found`);
    }

    if (reviewCase.status !== 'pending') {
      throw new BadRequestException(
        `Review case is already ${reviewCase.status}`,
      );
    }

    const [updatedCase] = await this.prisma.$transaction([
      this.prisma.reviewCase.update({
        where: { id },
        data: {
          status: 'approved',
          reviewerId,
          reviewerNotes: notes ?? null,
          reviewedAt: new Date(),
        },
      }),
      this.prisma.claim.update({
        where: { id: reviewCase.claimId },
        data: { status: 'verified' },
      }),
    ]);

    await this.auditService.record({
      actorId: reviewerId,
      entity: 'review_case',
      entityId: id,
      action: 'approve',
      metadata: { notes, claimId: reviewCase.claimId },
    });

    this.logger.log(`Review case ${id} approved by ${reviewerId}`);

    return updatedCase;
  }

  async rejectReviewCase(
    id: string,
    reviewerId: string,
    notes?: string,
  ) {
    const reviewCase = await this.prisma.reviewCase.findUnique({
      where: { id },
    });

    if (!reviewCase) {
      throw new NotFoundException(`Review case with ID ${id} not found`);
    }

    if (reviewCase.status !== 'pending') {
      throw new BadRequestException(
        `Review case is already ${reviewCase.status}`,
      );
    }

    const [updatedCase] = await this.prisma.$transaction([
      this.prisma.reviewCase.update({
        where: { id },
        data: {
          status: 'rejected',
          reviewerId,
          reviewerNotes: notes ?? null,
          reviewedAt: new Date(),
        },
      }),
      this.prisma.claim.update({
        where: { id: reviewCase.claimId },
        data: { status: 'archived' },
      }),
    ]);

    await this.auditService.record({
      actorId: reviewerId,
      entity: 'review_case',
      entityId: id,
      action: 'reject',
      metadata: { notes, claimId: reviewCase.claimId },
    });

    this.logger.log(`Review case ${id} rejected by ${reviewerId}`);

    return updatedCase;
  }
}
