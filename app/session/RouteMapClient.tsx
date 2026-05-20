'use client';

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import type { GpxPoint } from '@/lib/types';

export default function RouteMapClient({
  coords,
  distanceKm,
}: {
  coords: GpxPoint[];
  distanceKm?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || coords.length === 0) return;
    const el = containerRef.current;

    const map = L.map(el, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);

    const latlngs = coords.map((p) => [p.lat, p.lng] as [number, number]);
    const poly = L.polyline(latlngs, { color: '#C8E635', weight: 4, opacity: 0.9 }).addTo(map);
    map.fitBounds(poly.getBounds(), { padding: [24, 24] });

    // Start / end dots
    L.circleMarker(latlngs[0], { radius: 7, color: '#0F0F10', fillColor: '#C8E635', fillOpacity: 1, weight: 2 }).addTo(map);
    L.circleMarker(latlngs[latlngs.length - 1], { radius: 7, color: '#0F0F10', fillColor: '#fff', fillOpacity: 1, weight: 2 }).addTo(map);

    return () => { map.remove(); };
  }, [coords]);

  return (
    <div className="rounded-[24px] overflow-hidden border border-black/5 bg-white">
      <div ref={containerRef} style={{ height: 220 }} />
      {distanceKm !== undefined && (
        <div className="px-4 py-3 flex items-center justify-between">
          <p className="text-[12px] font-semibold text-[#0F0F10]">Distance</p>
          <p className="text-[13px] font-bold text-[#0F0F10] tabular-nums">{distanceKm.toFixed(2)} km</p>
        </div>
      )}
    </div>
  );
}
