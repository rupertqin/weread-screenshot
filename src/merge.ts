/**
 * 图片合并与碰撞检测模块（纯逻辑，可单测）
 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** 将 DOMRect 归一化为可计算的 Rect */
export function toRect(
  left: number,
  top: number,
  width: number,
  height: number,
): Rect {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

/**
 * AABB 碰撞检测：判断两个矩形是否重叠
 * 含边界接触（reuse）视为不重叠
 */
export function isOverlapping(a: Rect, b: Rect): boolean {
  return !(
    a.right < b.left ||
    a.left > b.right ||
    a.bottom < b.top ||
    a.top > b.bottom
  );
}

/**
 * 计算插图在画布坐标系中的目标绘制矩形。
 * 仅当与画布重叠时才返回有效结果（否则返回 null）。
 *
 * @param canvasRect 画布的视口矩形
 * @param imgRect    插图的视口矩形
 * @param canvasWidth 画布像素宽度
 * @param canvasHeight 画布像素高度
 */
export function computeDrawRect(
  canvasRect: Rect,
  imgRect: Rect,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number; w: number; h: number } | null {
  if (!isOverlapping(canvasRect, imgRect)) {
    return null;
  }
  const scaleX = canvasWidth / canvasRect.width;
  const scaleY = canvasHeight / canvasRect.height;
  return {
    x: (imgRect.left - canvasRect.left) * scaleX,
    y: (imgRect.top - canvasRect.top) * scaleY,
    w: imgRect.width * scaleX,
    h: imgRect.height * scaleY,
  };
}
