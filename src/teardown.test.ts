import { describe, expect, it, vi } from "vitest";
import { createDisposer } from "./teardown";

describe("createDisposer", () => {
  it("U23: a throwing step does not stop later steps; the first error is thrown", () => {
    const e1 = new Error("e1");
    const e3 = new Error("e3");
    const order: string[] = [];
    const s1 = vi.fn(() => { order.push("s1"); throw e1; });
    const s2 = vi.fn(() => { order.push("s2"); });
    const s3 = vi.fn(() => { order.push("s3"); throw e3; });
    const s4 = vi.fn(() => { order.push("s4"); });

    expect(createDisposer([s1, s2, s3, s4])).toThrow(e1);
    expect(order).toEqual(["s1", "s2", "s3", "s4"]);
    for (const s of [s1, s2, s3, s4]) expect(s).toHaveBeenCalledTimes(1);
  });

  it("U24: a second call runs nothing and does not throw", () => {
    const s1 = vi.fn(() => { throw new Error("e1"); });
    const s2 = vi.fn();
    const dispose = createDisposer([s1, s2]);
    expect(dispose).toThrow();

    expect(() => dispose()).not.toThrow();
    expect(s1).toHaveBeenCalledTimes(1);
    expect(s2).toHaveBeenCalledTimes(1);
  });

  it("no step throws → returns normally", () => {
    const s1 = vi.fn();
    const s2 = vi.fn();
    expect(() => createDisposer([s1, s2])()).not.toThrow();
    expect(s1).toHaveBeenCalledTimes(1);
    expect(s2).toHaveBeenCalledTimes(1);
  });
});
