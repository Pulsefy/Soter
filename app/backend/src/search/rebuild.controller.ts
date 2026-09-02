import { Request, Response } from 'express';
import { SearchRebuildService } from './rebuild.service';

const rebuildService = new SearchRebuildService();

export const searchRebuildController = {
  // POST /api/admin/search/rebuild
  async start(req: Request, res: Response) {
    try {
      const { dryRun, resume } = req.body;
      const result = await rebuildService.startRebuild({ dryRun, resume });
      res.status(200).json(result);
    } catch (error: any) {
      if (error.message.includes('Concurrent')) {
        res.status(409).json({ error: error.message });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  },

  // GET /api/admin/search/rebuild/status
  async status(req: Request, res: Response) {
    const status = await rebuildService.getStatus();
    res.status(200).json(status);
  },

  // POST /api/admin/search/rebuild/stop
  async stop(req: Request, res: Response) {
    const status = await rebuildService.stopRebuild();
    res.status(200).json(status);
  }
};
