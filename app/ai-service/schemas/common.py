from typing import Optional
from pydantic import BaseModel

class AnchorMetadata(BaseModel):
    campaign_ref: Optional[str] = None
    claim_id: Optional[str] = None
    package_id: Optional[str] = None
