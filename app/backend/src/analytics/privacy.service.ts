import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

@Injectable()
export class PrivacyService {
  /**
   * Fuzzes geo-coordinates to protect the exact location.
   * Adds a deterministic pseudo-random offset within ~500m to 1km based on the original coordinates.
   */
  public fuzzCoordinates(
    lat: number,
    lng: number,
  ): { lat: number; lng: number } {
    if (!lat && !lng) return { lat, lng };

    // Generate a deterministic hash based on coordinates
    const hash = createHash('sha256')
      .update(`${lat.toFixed(6)},${lng.toFixed(6)}`)
      .digest('hex');

    // Use the first few bytes of the hash to generate deterministic pseudo-random numbers
    const rand1 = parseInt(hash.substring(0, 8), 16) / 0xffffffff; // 0 to 1
    const rand2 = parseInt(hash.substring(8, 16), 16) / 0xffffffff; // 0 to 1

    // Target offset: 500m to 1000m
    // 1 degree of latitude is ~111km.
    const minOffsetDeg = 500 / 111000; // ~0.0045
    const maxOffsetDeg = 1000 / 111000; // ~0.0090

    const latOffsetMagnitude =
      minOffsetDeg + rand1 * (maxOffsetDeg - minOffsetDeg);
    const lngOffsetMagnitude =
      minOffsetDeg + rand2 * (maxOffsetDeg - minOffsetDeg);

    // Determine sign based on hash
    const latSign = parseInt(hash.substring(16, 17), 16) % 2 === 0 ? 1 : -1;
    const lngSign = parseInt(hash.substring(17, 18), 16) % 2 === 0 ? 1 : -1;

    // Adjust longitude offset magnitude based on latitude so actual distance is consistent
    // cos(lat) in radians
    const latRad = (lat * Math.PI) / 180;
    const adjustedLngOffsetMagnitude = lngOffsetMagnitude / Math.cos(latRad);

    let fuzzedLat = lat + latSign * latOffsetMagnitude;
    let fuzzedLng = lng + lngSign * adjustedLngOffsetMagnitude;

    // Clamp values if they go out of bounds
    fuzzedLat = Math.max(-90, Math.min(90, fuzzedLat));
    fuzzedLng =
      fuzzedLng > 180
        ? fuzzedLng - 360
        : fuzzedLng < -180
          ? fuzzedLng + 360
          : fuzzedLng;

    return {
      lat: Number(fuzzedLat.toFixed(5)),
      lng: Number(fuzzedLng.toFixed(5)),
    };
  }
}
