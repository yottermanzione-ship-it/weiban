import { useRef, type PointerEvent } from 'react';
type Point = { x: number; y: number };
type Crop = { zoom: number; x: number; y: number };
function center(points: Point[]): Point {
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
}
function distance(points: Point[]) {
  return points.length < 2
    ? 0
    : Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y);
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export function useAvatarGesture(
  crop: Crop,
  dimensions: Point,
  disabled: boolean,
  change: (crop: Crop) => void,
) {
  const pointers = useRef(new Map<number, Point>());
  const current = useRef(crop);
  current.current = crop;
  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (disabled || !pointers.current.has(event.pointerId)) return;
    const before = [...pointers.current.values()];
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const after = [...pointers.current.values()];
    const a = center(before),
      b = center(after);
    const old = current.current;
    const span = distance(before);
    const zoom = clamp(old.zoom * (span > 0 ? distance(after) / span : 1), 1, 3);
    const ratio = zoom / old.zoom;
    const bounds = event.currentTarget.getBoundingClientRect();
    const shortest = Math.min(dimensions.x, dimensions.y);
    function offset(axis: 'x' | 'y') {
      const size = dimensions[axis] / shortest;
      const previous = bounds.width * (size * old.zoom - 1);
      const next = bounds.width * (size * zoom - 1);
      const origin = axis === 'x' ? bounds.left : bounds.top;
      const pixels =
        ((old[axis] * previous) / 2) * ratio +
        (a[axis] - origin - bounds.width / 2) * (1 - ratio) +
        b[axis] -
        a[axis];
      return next > 0 ? clamp((2 * pixels) / next, -1, 1) : 0;
    }
    const result = { zoom, x: offset('x'), y: offset('y') };
    current.current = result;
    change(result);
  }
  function release(event: PointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(event.pointerId);
  }
  return {
    onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
      if (disabled || pointers.current.size >= 2) return;
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: move,
    onPointerUp: release,
    onPointerCancel: release,
    onLostPointerCapture: release,
  };
}
