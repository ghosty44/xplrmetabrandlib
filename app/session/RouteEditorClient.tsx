'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import type { GpxPoint } from '@/lib/types';

function haversine(a: GpxPoint, b: GpxPoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function totalKm(pts: GpxPoint[]): number {
  return pts.slice(1).reduce((acc, p, i) => acc + haversine(pts[i], p), 0);
}

async function fetchRouteSegment(from: GpxPoint, to: GpxPoint): Promise<GpxPoint[]> {
  const key = process.env.NEXT_PUBLIC_ORS_API_KEY;
  if (key) {
    try {
      const res = await fetch(
        `https://api.openrouteservice.org/v2/directions/foot-walking?api_key=${key}&start=${from.lng},${from.lat}&end=${to.lng},${to.lat}`,
        { headers: { Accept: 'application/json' } }
      );
      if (res.ok) {
        const data = await res.json() as { features?: Array<{ geometry: { coordinates: [number, number][] } }> };
        const raw = data.features?.[0]?.geometry?.coordinates ?? [];
        if (raw.length > 0) return raw.map(([lng, lat]) => ({ lat, lng }));
      }
    } catch { /* fall through to straight line */ }
  }
  // Fallback: straight line between the two points
  return [from, to];
}

export default function RouteEditorClient({
  initial,
  onSave,
  onClose,
}: {
  initial?: GpxPoint[];
  onSave: (coords: GpxPoint[], distanceKm: number) => void;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const polyRef = useRef<L.Polyline | null>(null);
  const markersRef = useRef<L.CircleMarker[]>([]);
  const routeSegmentsRef = useRef<GpxPoint[][]>([]);
  const waypointsRef = useRef<GpxPoint[]>([]);

  const [loading, setLoading] = useState(false);
  const [waypointCount, setWaypointCount] = useState(0);
  const [distKm, setDistKm] = useState(0);
  const hasORS = !!process.env.NEXT_PUBLIC_ORS_API_KEY;

  const flatCoords = useCallback((): GpxPoint[] => {
    const segs = routeSegmentsRef.current;
    if (segs.length === 0) return waypointsRef.current.slice(0, 1);
    return segs.flat();
  }, []);

  const redrawPoly = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const coords = flatCoords();
    const latlngs = coords.map((p) => [p.lat, p.lng] as [number, number]);
    if (polyRef.current) {
      polyRef.current.setLatLngs(latlngs);
    } else if (latlngs.length > 0) {
      polyRef.current = L.polyline(latlngs, { color: '#C8E635', weight: 4, opacity: 0.9 }).addTo(map);
    }
    setDistKm(totalKm(coords));
  }, [flatCoords]);

  // Init map
  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { attributionControl: false }).setView([48.856, 2.352], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    mapRef.current = map;

    // Restore initial route
    if (initial && initial.length > 0) {
      waypointsRef.current = [initial[0], initial[initial.length - 1]];
      routeSegmentsRef.current = [initial];
      setWaypointCount(2);
      const latlngs = initial.map((p) => [p.lat, p.lng] as [number, number]);
      polyRef.current = L.polyline(latlngs, { color: '#C8E635', weight: 4 }).addTo(map);
      map.fitBounds(polyRef.current.getBounds(), { padding: [24, 24] });
      setDistKm(totalKm(initial));

      const addWpMarker = (p: GpxPoint) => {
        const m = L.circleMarker([p.lat, p.lng], { radius: 6, color: '#0F0F10', fillColor: '#C8E635', fillOpacity: 1, weight: 2 }).addTo(map);
        markersRef.current.push(m);
      };
      addWpMarker(initial[0]);
      addWpMarker(initial[initial.length - 1]);
    } else {
      // Try geolocation for initial center
      navigator.geolocation?.getCurrentPosition(({ coords: c }) => {
        map.setView([c.latitude, c.longitude], 14);
      });
    }

    const handleClick = async (e: L.LeafletMouseEvent) => {
      if (!mapRef.current) return;
      const pt: GpxPoint = { lat: e.latlng.lat, lng: e.latlng.lng };
      const prev = waypointsRef.current[waypointsRef.current.length - 1];
      waypointsRef.current = [...waypointsRef.current, pt];
      setWaypointCount(waypointsRef.current.length);

      // Waypoint marker
      const m = L.circleMarker([pt.lat, pt.lng], { radius: 6, color: '#0F0F10', fillColor: '#C8E635', fillOpacity: 1, weight: 2 }).addTo(mapRef.current);
      markersRef.current = [...markersRef.current, m];

      if (prev) {
        setLoading(true);
        const seg = await fetchRouteSegment(prev, pt);
        routeSegmentsRef.current = [...routeSegmentsRef.current, seg];
        redrawPoly();
        setLoading(false);
      } else {
        redrawPoly();
      }
    };

    map.on('click', handleClick);
    return () => { map.off('click', handleClick); map.remove(); mapRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUndo = () => {
    if (waypointsRef.current.length === 0) return;
    waypointsRef.current = waypointsRef.current.slice(0, -1);
    if (routeSegmentsRef.current.length > 0) {
      routeSegmentsRef.current = routeSegmentsRef.current.slice(0, -1);
    }
    const last = markersRef.current[markersRef.current.length - 1];
    if (last) { last.remove(); markersRef.current = markersRef.current.slice(0, -1); }
    setWaypointCount(waypointsRef.current.length);
    redrawPoly();
  };

  const handleReset = () => {
    waypointsRef.current = [];
    routeSegmentsRef.current = [];
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    if (polyRef.current) { polyRef.current.remove(); polyRef.current = null; }
    setWaypointCount(0);
    setDistKm(0);
  };

  const handleSave = () => {
    const coords = flatCoords();
    if (coords.length < 2) return;
    onSave(coords, parseFloat(totalKm(coords).toFixed(2)));
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0F0F10] flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 pt-12 pb-3 bg-[#0F0F10]/90 backdrop-blur-sm">
        <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 2L4 7l5 5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div className="flex-1">
          <p className="text-[14px] font-bold text-white">Tracer un itinéraire</p>
          <p className="text-[11px] text-white/40">
            {waypointCount === 0 ? 'Appuie sur la carte pour ajouter des points' : `${waypointCount} point${waypointCount > 1 ? 's' : ''} · ${distKm.toFixed(2)} km`}
          </p>
        </div>
        {loading && <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />}
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <div ref={containerRef} className="w-full h-full" />
        {!hasORS && (
          <div className="absolute bottom-3 left-3 right-3 bg-black/70 rounded-[12px] px-3 py-2 pointer-events-none">
            <p className="text-[11px] text-white/60 text-center">Mode simplifié · Ajouter NEXT_PUBLIC_ORS_API_KEY pour le routage routier</p>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="px-4 pb-10 pt-3 bg-[#0F0F10]/90 backdrop-blur-sm flex gap-2">
        <button
          onClick={handleUndo}
          disabled={waypointCount === 0}
          className="w-12 h-12 rounded-[14px] bg-white/10 text-white text-[11px] font-semibold disabled:opacity-30 flex items-center justify-center"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 7h9a5 5 0 0 1 0 10H7"/><path d="M3 7l4-4M3 7l4 4"/>
          </svg>
        </button>
        <button
          onClick={handleReset}
          disabled={waypointCount === 0}
          className="w-12 h-12 rounded-[14px] bg-white/10 text-white disabled:opacity-30 flex items-center justify-center"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>
          </svg>
        </button>
        <button
          onClick={handleSave}
          disabled={waypointCount < 2}
          className="flex-1 h-12 rounded-[14px] bg-white text-[#0F0F10] text-[13px] font-bold disabled:opacity-30 transition-all active:scale-[0.97]"
        >
          Enregistrer · {distKm.toFixed(2)} km
        </button>
      </div>
    </div>
  );
}
