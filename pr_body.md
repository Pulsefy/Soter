# Title: Location Anonymization Service for Map Privacy

Resolves #222

## Tasks and Fixes Made
1. **Created `PrivacyService`**:
   - Implemented an algorithm to fuzz geo-coordinates and protect the exact locations.
   - Using a deterministic hash based on coordinates to add an offset within a 500m to 1km radius limit.
   - Added logic to keep fuzzing consistent for the same location to prevent jumping.

2. **Backend Module Updating**:
   - Implemented `getMapAnonymizedData` inside `AnalyticsService` formatting to standardized `GeoJsonFeatureCollection`.
   - Exposed `GET /analytics/map-anonymized` inside `AnalyticsController`.

3. **Data Transfer Objects (DTOs)**:
   - Built out `GeoJsonFeature` and `GeoJsonFeatureCollection` definition for the endpoint types.

4. **CI Checks Verified**:
   - Nest.js backend tests passed smoothly without regressions.
   - Project dependencies correctly build. 

Please review and merge.
