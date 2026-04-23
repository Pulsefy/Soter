"""
Proof-of-life utilities for face detection and basic liveness verification.

This module uses OpenCV Haar cascades for:
- Face presence detection
- Eye detection (blink signal)
- Head orientation/movement signal across burst frames
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
import time
import metrics


BBox = Tuple[int, int, int, int]


@dataclass
class ProofOfLifeConfig:
    """Configuration for proof-of-life analysis."""

    confidence_threshold: float = 0.65
    min_face_size: int = 80


class ProofOfLifeAnalyzer:
    """OpenCV-based analyzer for face detection and liveness checks."""

    def __init__(self, config: Optional[ProofOfLifeConfig] = None) -> None:
        self.config = config or ProofOfLifeConfig()

        start_load = time.time()
        self.face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
        metrics.MODEL_LOAD_TIME.labels(model_name="haarcascade_frontalface").observe(time.time() - start_load)

        start_load2 = time.time()
        self.eye_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_eye.xml"
        )
        metrics.MODEL_LOAD_TIME.labels(model_name="haarcascade_eye").observe(time.time() - start_load2)

        if self.face_cascade.empty() or self.eye_cascade.empty():
            raise RuntimeError("Unable to load OpenCV Haar cascade models")

    def analyze(
        self,
        selfie_image_base64: str,
        burst_images_base64: Optional[List[str]] = None,
        confidence_threshold: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Analyze selfie and optional burst frames for proof-of-life.

        Returns:
            Dict with is_real_person, confidence score, threshold and checks.
        """
        start_inference = time.time()
        selfie = self._decode_image(selfie_image_base64)
        selfie_gray = cv2.cvtColor(selfie, cv2.COLOR_BGR2GRAY)

        face_bbox = self._detect_primary_face(selfie_gray)
        if face_bbox is None:
            threshold = self._resolve_threshold(confidence_threshold)
            return {
                "is_real_person": False,
                "confidence": 0.05,
                "threshold": threshold,
                "checks": {
                    "face_detected": False,
                    "blink_detected": False,
                    "head_movement_detected": False,
                    "processed_burst_frames": 0,
                },
                "reason": "No face detected in selfie image",
            }

        face_confidence = self._estimate_face_confidence(face_bbox, selfie_gray.shape)
        quality_score = self._estimate_image_quality(selfie_gray)

        checks = {
            "face_detected": True,
            "blink_detected": False,
            "head_movement_detected": False,
            "processed_burst_frames": 0,
        }
        liveness_score = 0.40

        if burst_images_base64:
            liveness = self._analyze_burst_frames(burst_images_base64)
            checks.update(liveness)
            liveness_score = self._score_liveness(
                blink_detected=checks["blink_detected"],
                head_movement_detected=checks["head_movement_detected"],
                processed_burst_frames=checks["processed_burst_frames"],
            )

        threshold = self._resolve_threshold(confidence_threshold)
        confidence = self._combine_scores(
            face_confidence=face_confidence,
            quality_score=quality_score,
            liveness_score=liveness_score,
        )

        burst_required = bool(burst_images_base64)
        has_liveness_evidence = (
            checks["blink_detected"] or checks["head_movement_detected"] or not burst_required
        )
        is_real_person = confidence >= threshold and has_liveness_evidence

        reason = "Face detected and confidence threshold met"
        if burst_required and not has_liveness_evidence:
            reason = "No liveness signal detected from burst frames"
        elif confidence < threshold:
            reason = "Confidence score is below threshold"

        result = {
            "is_real_person": is_real_person,
            "confidence": confidence,
            "threshold": threshold,
            "checks": checks,
            "reason": reason,
        }
        
        metrics.INFERENCE_LATENCY.labels(task_type="proof_of_life").observe(time.time() - start_inference)
        metrics.logger.info(f"Proof of life inference completed in {time.time() - start_inference:.4f}s")
        return result

    def _decode_image(self, image_base64: str) -> np.ndarray:
        """Decode a base64 image string into an OpenCV BGR image."""
        if not image_base64 or not image_base64.strip():
            raise ValueError("Image payload is empty")

        payload = image_base64
        if "," in image_base64 and image_base64.strip().startswith("data:image"):
            payload = image_base64.split(",", 1)[1]

        try:
            image_bytes = base64.b64decode(payload, validate=True)
        except Exception as exc:
            raise ValueError("Invalid base64 image payload") from exc

        np_buffer = np.frombuffer(image_bytes, dtype=np.uint8)
        image = cv2.imdecode(np_buffer, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("Unable to decode image bytes")

        return image

    def _detect_primary_face(self, gray_image: np.ndarray) -> Optional[BBox]:
        """Detect and return the largest face in the image."""
        faces = self.face_cascade.detectMultiScale(
            gray_image,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(self.config.min_face_size, self.config.min_face_size),
        )

        if len(faces) == 0:
            return None

        return max(faces, key=lambda box: int(box[2]) * int(box[3]))

    def _count_eyes(self, gray_image: np.ndarray, face_bbox: BBox) -> int:
        """Count eyes detected inside the face bounding box."""
        x, y, w, h = face_bbox
        face_roi = gray_image[y : y + h, x : x + w]
        eyes = self.eye_cascade.detectMultiScale(
            face_roi,
            scaleFactor=1.1,
            minNeighbors=6,
            minSize=(12, 12),
        )
        return len(eyes)

    def _analyze_burst_frames(self, frames_base64: List[str]) -> Dict[str, Any]:
        """Analyze burst frames for blink and head movement liveness signals."""
        centers: List[Tuple[float, float]] = []
        eye_counts: List[int] = []
        face_widths: List[int] = []
        processed = 0

        for encoded in frames_base64[:10]:
            try:
                image = self._decode_image(encoded)
            except ValueError:
                continue

            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            face_bbox = self._detect_primary_face(gray)
            if face_bbox is None:
                continue

            x, y, w, h = face_bbox
            centers.append((x + (w / 2.0), y + (h / 2.0)))
            face_widths.append(int(w))
            eye_counts.append(self._count_eyes(gray, face_bbox))
            processed += 1

        blink_detected = False
        head_movement_detected = False

        if eye_counts:
            has_open_eyes = any(count >= 2 for count in eye_counts)
            has_closed_or_partial = any(count <= 1 for count in eye_counts)
            blink_detected = has_open_eyes and has_closed_or_partial

        if len(centers) >= 2 and face_widths:
            x_positions = [c[0] for c in centers]
            y_positions = [c[1] for c in centers]
            movement = max(max(x_positions) - min(x_positions), max(y_positions) - min(y_positions))
            avg_width = max(float(sum(face_widths) / len(face_widths)), 1.0)
            head_movement_detected = (movement / avg_width) >= 0.15

        return {
            "blink_detected": blink_detected,
            "head_movement_detected": head_movement_detected,
            "processed_burst_frames": processed,
        }

    def _estimate_face_confidence(self, face_bbox: BBox, image_shape: Tuple[int, int]) -> float:
        """Estimate face confidence from face size relative to image."""
        _, _, w, h = face_bbox
        image_area = float(image_shape[0] * image_shape[1])
        face_area_ratio = (w * h) / image_area

        if face_area_ratio < 0.02:
            return 0.45
        if face_area_ratio > 0.50:
            return 0.55

        normalized = (face_area_ratio - 0.02) / 0.48
        return round(0.55 + min(max(normalized, 0.0), 1.0) * 0.40, 4)

    def _estimate_image_quality(self, gray_image: np.ndarray) -> float:
        """Estimate image quality using brightness and blur heuristics."""
        brightness = float(np.mean(gray_image))
        sharpness = float(cv2.Laplacian(gray_image, cv2.CV_64F).var())

        brightness_score = 1.0 - min(abs(brightness - 120.0) / 120.0, 1.0)
        sharpness_score = min(sharpness / 250.0, 1.0)

        return round((brightness_score * 0.5) + (sharpness_score * 0.5), 4)

    def _score_liveness(
        self,
        blink_detected: bool,
        head_movement_detected: bool,
        processed_burst_frames: int,
    ) -> float:
        """Score liveness signals from burst analysis."""
        if processed_burst_frames == 0:
            return 0.25

        score = 0.25
        if blink_detected:
            score += 0.45
        if head_movement_detected:
            score += 0.30

        return round(min(score, 1.0), 4)

    def _combine_scores(self, face_confidence: float, quality_score: float, liveness_score: float) -> float:
        """Combine face, quality, and liveness scores into final confidence."""
        confidence = (face_confidence * 0.50) + (quality_score * 0.20) + (liveness_score * 0.30)
        return round(min(max(confidence, 0.0), 1.0), 4)

    def _resolve_threshold(self, override: Optional[float]) -> float:
        """Resolve request threshold or fallback to configured default."""
        threshold = self.config.confidence_threshold if override is None else override
        threshold = min(max(float(threshold), 0.0), 1.0)
        return round(threshold, 4)