from typing import Optional
from pydantic import BaseModel, Field

class AnchorMetadata(BaseModel):
    campaign_ref: Optional[str] = Field(None, examples=["campaign-2024-001"])
    claim_id: Optional[str] = Field(None, examples=["claim-abc123"])
    package_id: Optional[str] = Field(None, examples=["package-x7y8z9"])

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "campaign_ref": "campaign-2024-001",
                    "claim_id": "claim-abc123"
                }
            ]
        }
    }
