import { describe, it, expect, beforeEach } from "vitest";
import { createProcessQueue } from "../queue.js";
import type { QueuedProcess } from "../types.js";
import type { Socket } from "net";

function createMockProcess(id: string): QueuedProcess {
  return {
    id,
    socket: {} as Socket,
    args: ["--version"],
    cwd: "/tmp",
    env: { PATH: "/usr/bin" },
    timestamp: Date.now(),
    targetBinary: "node",
  };
}

describe("createProcessQueue", () => {
  let queue: ReturnType<typeof createProcessQueue>;

  beforeEach(() => {
    queue = createProcessQueue(5);
  });

  describe("enqueue", () => {
    it("adds process to queue", () => {
      const process = createMockProcess("p1");
      expect(queue.enqueue(process)).toBe(true);
      expect(queue.size()).toBe(1);
    });

    it("rejects when queue is full", () => {
      for (let i = 0; i < 5; i++) {
        queue.enqueue(createMockProcess(`p${i}`));
      }
      expect(queue.enqueue(createMockProcess("overflow"))).toBe(false);
      expect(queue.size()).toBe(5);
    });
  });

  describe("dequeue", () => {
    it("returns and removes first process (FIFO)", () => {
      queue.enqueue(createMockProcess("p1"));
      queue.enqueue(createMockProcess("p2"));
      queue.enqueue(createMockProcess("p3"));

      expect(queue.dequeue()?.id).toBe("p1");
      expect(queue.dequeue()?.id).toBe("p2");
      expect(queue.size()).toBe(1);
    });

    it("returns undefined on empty queue", () => {
      expect(queue.dequeue()).toBeUndefined();
    });
  });

  describe("peek", () => {
    it("returns first process without removing", () => {
      queue.enqueue(createMockProcess("p1"));
      queue.enqueue(createMockProcess("p2"));

      expect(queue.peek()?.id).toBe("p1");
      expect(queue.peek()?.id).toBe("p1");
      expect(queue.size()).toBe(2);
    });

    it("returns undefined on empty queue", () => {
      expect(queue.peek()).toBeUndefined();
    });
  });

  describe("remove", () => {
    it("removes specific process by id", () => {
      queue.enqueue(createMockProcess("p1"));
      queue.enqueue(createMockProcess("p2"));
      queue.enqueue(createMockProcess("p3"));

      const removed = queue.remove("p2");
      expect(removed?.id).toBe("p2");
      expect(queue.size()).toBe(2);
      expect(queue.getAll().map((p) => p.id)).toEqual(["p1", "p3"]);
    });

    it("returns undefined for non-existent id", () => {
      queue.enqueue(createMockProcess("p1"));
      expect(queue.remove("nonexistent")).toBeUndefined();
    });
  });

  describe("getPosition", () => {
    it("returns 1-based position", () => {
      queue.enqueue(createMockProcess("p1"));
      queue.enqueue(createMockProcess("p2"));
      queue.enqueue(createMockProcess("p3"));

      expect(queue.getPosition("p1")).toBe(1);
      expect(queue.getPosition("p2")).toBe(2);
      expect(queue.getPosition("p3")).toBe(3);
    });

    it("returns -1 for non-existent id", () => {
      expect(queue.getPosition("nonexistent")).toBe(-1);
    });
  });

  describe("isEmpty and isFull", () => {
    it("reports empty state correctly", () => {
      expect(queue.isEmpty()).toBe(true);
      queue.enqueue(createMockProcess("p1"));
      expect(queue.isEmpty()).toBe(false);
    });

    it("reports full state correctly", () => {
      expect(queue.isFull()).toBe(false);
      for (let i = 0; i < 5; i++) {
        queue.enqueue(createMockProcess(`p${i}`));
      }
      expect(queue.isFull()).toBe(true);
    });
  });

  describe("clear", () => {
    it("removes all processes", () => {
      queue.enqueue(createMockProcess("p1"));
      queue.enqueue(createMockProcess("p2"));
      queue.clear();
      expect(queue.size()).toBe(0);
      expect(queue.isEmpty()).toBe(true);
    });
  });

  describe("getAll", () => {
    it("returns copy of queue", () => {
      queue.enqueue(createMockProcess("p1"));
      queue.enqueue(createMockProcess("p2"));

      const all = queue.getAll();
      expect(all.length).toBe(2);

      // Modifying returned array should not affect queue
      all.pop();
      expect(queue.size()).toBe(2);
    });
  });
});
