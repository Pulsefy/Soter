import pytest
from fastapi import FastAPI, Request
from prometheus_client import REGISTRY

import metrics

def test_metrics_label_cardinality_audit():
    """
    Audit every metric label and its cardinality bound.
    Unbounded values must be bucketed, hashed, or removed.
    This test asserts label values come from a bounded set.
    """
    unbounded_keywords = ["id", "error_string", "message", "url", "user", "artifact", "claim"]
    
    # Check all metrics in our app's registry
    for metric in REGISTRY.collect():
        # Only check metrics that are defined in our app (not internal python metrics)
        if metric.name.startswith("python_") or metric.name.startswith("process_"):
            continue
            
        for sample in metric.samples:
            for label_name, label_value in sample.labels.items():
                # Assert that label names don't imply unbounded cardinality
                for keyword in unbounded_keywords:
                    # 'endpoint' is allowed because we specifically bounded it to route templates
                    if label_name == "endpoint":
                        continue
                    assert keyword not in label_name.lower(), f"Metric {metric.name} uses unbounded label name: {label_name}"
                
                # Check that label values are not UUIDs or obvious unbound strings
                # In a real running system, this prevents accumulating unbound values.
                # Here we just make sure our default/initial states don't have them.
                assert len(str(label_value)) < 100, f"Label value for {label_name} is too long, indicating it might be unbounded: {label_value}"


def test_get_route_path_bounds_urls():
    """
    Ensure get_route_path returns a bounded route template instead of a raw URL.
    """
    app = FastAPI()
    
    @app.get("/api/v1/claims/{claim_id}/artifacts/{artifact_id}")
    def dummy_route(claim_id: str, artifact_id: str):
        return {}

    @app.post("/api/v1/users/{user_id}/actions")
    def dummy_action(user_id: str):
        return {}

    # Simulate a request matching the first route
    scope1 = {
        "type": "http",
        "method": "GET",
        "path": "/api/v1/claims/123e4567-e89b-12d3-a456-426614174000/artifacts/9876",
        "app": app,
    }
    req1 = Request(scope1)
    # FastApi requires the router to process the request to attach the route in standard flow,
    # but our get_route_path iterates over routes manually.
    
    path1 = metrics.get_route_path(req1)
    assert path1 == "/api/v1/claims/{claim_id}/artifacts/{artifact_id}"

    # Simulate a request matching the second route
    scope2 = {
        "type": "http",
        "method": "POST",
        "path": "/api/v1/users/admin-user-123/actions",
        "app": app,
    }
    req2 = Request(scope2)
    path2 = metrics.get_route_path(req2)
    assert path2 == "/api/v1/users/{user_id}/actions"

    # Simulate an unmatched request
    scope3 = {
        "type": "http",
        "method": "GET",
        "path": "/api/v1/unknown/route/123",
        "app": app,
    }
    req3 = Request(scope3)
    path3 = metrics.get_route_path(req3)
    assert path3 == "unmatched_route"
