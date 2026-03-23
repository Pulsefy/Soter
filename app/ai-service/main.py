from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional
import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN
from sklearn.preprocessing import StandardScaler
import hashlib

app = FastAPI(title="Soter Fraud Detection ML Service")

class Claim(BaseModel):
    id: str
    amount: float
    recipientRef: str
    evidenceRef: Optional[str] = None
    ipAddress: Optional[str] = None

class ClaimWithRisk(BaseModel):
    id: str
    fraudRiskScore: float

class BatchAnalyzeRequest(BaseModel):
    claims: List[Claim]

@app.post("/analyze-batch", response_model=List[ClaimWithRisk])
def analyze_batch(request: BatchAnalyzeRequest):
    claims = request.claims
    if not claims:
        return []

    # If too few claims to cluster effectively, return default low risk
    if len(claims) < 3:
        return [ClaimWithRisk(id=c.id, fraudRiskScore=0.0) for c in claims]

    data = []
    for c in claims:
        # Encode IP
        encoded_ip = 0
        if c.ipAddress:
            encoded_ip = int(hashlib.md5(c.ipAddress.encode()).hexdigest(), 16) % 10000 
        
        # Encode evidence
        encoded_evidence = 0
        if c.evidenceRef:
            encoded_evidence = int(hashlib.md5(c.evidenceRef.encode()).hexdigest(), 16) % 10000
            
        data.append({
            "id": c.id,
            "amount": float(c.amount),
            "ip_encoded": encoded_ip,
            "evidence_encoded": encoded_evidence
        })
        
    df = pd.DataFrame(data)
    
    # Scale features
    scaler = StandardScaler()
    scaled_features = scaler.fit_transform(df[['amount', 'ip_encoded', 'evidence_encoded']])
    
    # Cluster using DBSCAN.
    # eps = 0.5, min_samples = 3 (we consider tight clusters of highly similar features to be suspicious)
    db = DBSCAN(eps=0.5, min_samples=3).fit(scaled_features)
    labels = db.labels_
    
    df['cluster'] = labels
    fraud_scores = {}
    
    for cluster_id in set(labels):
        if cluster_id == -1:
            # Noise / outliers - normal distinct claims or random small anomalies
            cluster_mask = (df['cluster'] == cluster_id)
            for idx in df[cluster_mask].index:
                fraud_scores[df.loc[idx, 'id']] = 0.1 # low base risk
            continue
            
        cluster_claims = df[df['cluster'] == cluster_id]
        
        # Calculate cluster purity on IP or Evidence
        ip_purity = cluster_claims['ip_encoded'].nunique()
        evidence_purity = cluster_claims['evidence_encoded'].nunique()
        
        # If clustered mainly because of identical IP or Evidence (purity 1 for cluster size >= 3) -> very high risk
        risk = 0.4 # Baseline for a cluster
        
        # High risk if same IP
        if ip_purity == 1 and cluster_claims.iloc[0]['ip_encoded'] != 0:
            risk = 0.95
        # Even higher if same evidence
        elif evidence_purity == 1 and cluster_claims.iloc[0]['evidence_encoded'] != 0:
            risk = 0.99
            
        for idx in cluster_claims.index:
            fraud_scores[df.loc[idx, 'id']] = risk

    # Format result
    result = []
    for c in claims:
        score = fraud_scores.get(c.id, 0.0)
        result.append(ClaimWithRisk(id=c.id, fraudRiskScore=score))
        
    return result

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
