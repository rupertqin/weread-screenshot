import { describe, it, expect } from "vitest";
import { isOverlapping, computeDrawRect, toRect } from "../src/merge";

describe("isOverlapping - AABB 碰撞检测", () => {
  it("两个分离的矩形不重叠", () => {
    const a = toRect(0, 0, 100, 100);
    const b = toRect(200, 0, 100, 100);
    expect(isOverlapping(a, b)).toBe(false);
  });

  it("两个重叠的矩形判定为重叠", () => {
    const a = toRect(0, 0, 100, 100);
    const b = toRect(50, 50, 100, 100);
    expect(isOverlapping(a, b)).toBe(true);
  });

  it("一个包含另一个时重叠", () => {
    const outer = toRect(0, 0, 300, 300);
    const inner = toRect(100, 100, 50, 50);
    expect(isOverlapping(outer, inner)).toBe(true);
  });

  it("边界接触（right==left）视为重叠", () => {
    // 实现约定：!(a.right < b.left ...)，即 right==left 时仍判定重叠
    const a = toRect(0, 0, 100, 100);
    const b = toRect(100, 0, 100, 100); // a.right=100 与 b.left=100 紧贴
    expect(isOverlapping(a, b)).toBe(true);
  });

  it("垂直方向重叠但水平分离则不重叠", () => {
    const a = toRect(0, 0, 50, 200);
    const b = toRect(100, 0, 50, 200);
    expect(isOverlapping(a, b)).toBe(false);
  });
});

describe("computeDrawRect - 画布坐标映射", () => {
  const canvasRect = toRect(0, 0, 800, 600);
  const canvasWidth = 1600;
  const canvasHeight = 1200;

  it("完全落在画布内的插图，返回按比例放大的绘制矩形", () => {
    // 插图视口 100x100，位于 (100,100)，画布视口 800x600，像素 1600x1200
    // scaleX=2, scaleY=2 => x=200, y=200, w=200, h=200
    const imgRect = toRect(100, 100, 100, 100);
    expect(computeDrawRect(canvasRect, imgRect, canvasWidth, canvasHeight)).toEqual({
      x: 200,
      y: 200,
      w: 200,
      h: 200,
    });
  });

  it("与画布不重叠的插图返回 null", () => {
    const imgRect = toRect(900, 0, 100, 100); // 超出画布右边界
    expect(computeDrawRect(canvasRect, imgRect, canvasWidth, canvasHeight)).toBeNull();
  });

  it("部分重叠的插图，坐标正确（可为负值）", () => {
    // 插图从 (-50, 0) 开始，宽 200，与画布左边界部分重叠
    const imgRect = toRect(-50, 0, 200, 100);
    // overlap=true；x = (-50 - 0) * 2 = -100, y=0, w=400, h=200
    expect(computeDrawRect(canvasRect, imgRect, canvasWidth, canvasHeight)).toEqual({
      x: -100,
      y: 0,
      w: 400,
      h: 200,
    });
  });
});
