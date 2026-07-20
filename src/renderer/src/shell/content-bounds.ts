import type { ViewBounds } from '../../../shared/ipc/bridge';

/** 内容区视口矩形的最小子集（DOMRect 兼容）。 */
export interface ContentRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 由内容区视口矩形计算内嵌视图 bounds：取整且非负，贴合主进程定位需求。 */
export function rectToBounds(rect: ContentRect): ViewBounds {
  return {
    x: Math.max(0, Math.round(rect.left)),
    y: Math.max(0, Math.round(rect.top)),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
  };
}

/** 两个 bounds 是否相等；用于跳过重复上报，减少无谓重排。 */
export function boundsEqual(a: ViewBounds | null, b: ViewBounds | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }

  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
