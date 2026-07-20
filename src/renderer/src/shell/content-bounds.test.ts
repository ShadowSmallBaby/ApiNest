import { boundsEqual, rectToBounds } from './content-bounds';

describe('rectToBounds', () => {
  it('取整视口矩形为整数像素 bounds', () => {
    expect(rectToBounds({ left: 240.4, top: 40.6, width: 1039.5, height: 760.2 })).toEqual({
      x: 240,
      y: 41,
      width: 1040,
      height: 760,
    });
  });

  it('将负坐标钳制为非负，避免异常几何', () => {
    expect(rectToBounds({ left: -5, top: -2, width: 100, height: 50 })).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
  });
});

describe('boundsEqual', () => {
  it('几何完全一致时判定相等', () => {
    const a = { x: 1, y: 2, width: 3, height: 4 };
    const b = { x: 1, y: 2, width: 3, height: 4 };
    expect(boundsEqual(a, b)).toBe(true);
  });

  it('任一维度不同即判定不相等', () => {
    expect(boundsEqual({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 5 })).toBe(false);
  });

  it('null 与非 null 判定不相等，双 null 判定相等', () => {
    expect(boundsEqual(null, { x: 0, y: 0, width: 0, height: 0 })).toBe(false);
    expect(boundsEqual(null, null)).toBe(true);
  });
});
