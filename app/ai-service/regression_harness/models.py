import json
import os
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any

@dataclass
class BoundingBox:
    x: int
    y: int
    width: int
    height: int

    def to_dict(self):
        return {"x": self.x, "y": self.y, "width": self.width, "height": self.height}

    @classmethod
    def from_dict(cls, data: dict):
        return cls(**data)

@dataclass
class EvaluationSample:
    id: str
    image_path: str
    expected_fields: Dict[str, str]
    expected_bboxes: Dict[str, BoundingBox] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)

@dataclass
class FieldEvaluation:
    field_name: str
    expected_value: Optional[str]
    actual_value: Optional[str]
    is_match: bool
    error_type: Optional[str] = None # 'missing_field', 'incorrect_value', 'unexpected_field'
    confidence: float = 0.0

@dataclass
class SampleResult:
    sample_id: str
    field_evaluations: List[FieldEvaluation]
    passed: bool
    raw_text: str
    processing_time_ms: int

@dataclass
class RegressionReport:
    total_samples: int
    passed_samples: int
    failed_samples: int
    accuracy_percentage: float
    error_counts: Dict[str, int]
    sample_results: List[SampleResult]

    def to_dict(self):
        return {
            "summary": {
                "total": self.total_samples,
                "passed": self.passed_samples,
                "failed": self.failed_samples,
                "accuracy": self.accuracy_percentage,
                "error_breakdown": self.error_counts
            },
            "details": [
                {
                    "sample_id": r.sample_id,
                    "passed": r.passed,
                    "fields": [
                        {
                            "name": f.field_name,
                            "expected": f.expected_value,
                            "actual": f.actual_value,
                            "match": f.is_match,
                            "error": f.error_type,
                            "confidence": f.confidence
                        } for f in r.field_evaluations
                    ]
                } for r in self.sample_results
            ]
        }
