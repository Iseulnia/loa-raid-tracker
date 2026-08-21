"use client";

import { useState } from "react";
import { upsertRaid, deleteRaid } from "@/app/actions";

type RaidRow = {
  id: string;
  name: string;
  difficulty: string;
  min_item_level: number;
  gate_count: number;
  gold_per_gate: number[];
  sort_order: number;
  is_active: boolean;
};

const emptyForm = { name: "", difficulty: "노말", minItemLevel: "", goldPerGate: "" };

export default function RaidManager({ initialRaids }: { initialRaids: RaidRow[] }) {
  const [raids, setRaids] = useState(initialRaids);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const goldPerGate = form.goldPerGate
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));

    if (!form.name.trim() || goldPerGate.length === 0) {
      setError("레이드 이름과 관문별 골드(쉼표로 구분)를 입력해주세요.");
      return;
    }

    const input = {
      name: form.name.trim(),
      difficulty: form.difficulty.trim(),
      minItemLevel: Number(form.minItemLevel) || 0,
      goldPerGate,
      isActive: true,
      sortOrder: raids.length,
    };

    await upsertRaid(input);
    setRaids((prev) => [
      ...prev,
      {
        id: `temp-${Date.now()}`,
        name: input.name,
        difficulty: input.difficulty,
        min_item_level: input.minItemLevel,
        gate_count: goldPerGate.length,
        gold_per_gate: goldPerGate,
        sort_order: input.sortOrder,
        is_active: true,
      },
    ]);
    setForm(emptyForm);
  }

  async function handleDelete(id: string) {
    setRaids((prev) => prev.filter((r) => r.id !== id));
    await deleteRaid(id);
  }

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={handleAdd} className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="grid grid-cols-2 gap-3">
          <input
            type="text"
            placeholder="레이드 이름 (예: 아브렐슈드)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-500"
          />
          <input
            type="text"
            placeholder="난이도 (예: 하드)"
            value={form.difficulty}
            onChange={(e) => setForm({ ...form, difficulty: e.target.value })}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-500"
          />
          <input
            type="number"
            placeholder="입장 최소 아이템레벨"
            value={form.minItemLevel}
            onChange={(e) => setForm({ ...form, minItemLevel: e.target.value })}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-500"
          />
          <input
            type="text"
            placeholder="관문별 골드 (예: 4000,4500,5200)"
            value={form.goldPerGate}
            onChange={(e) => setForm({ ...form, goldPerGate: e.target.value })}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-500"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="self-start rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
          레이드 추가
        </button>
      </form>

      <ul className="flex flex-col gap-2">
        {raids.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm text-neutral-900"
          >
            <div>
              <span className="font-medium">
                {r.name} {r.difficulty}
              </span>{" "}
              <span className="text-neutral-400">
                (입장 {r.min_item_level.toLocaleString()}+, {r.gate_count}관문, {r.gold_per_gate.join("/")}G)
              </span>
            </div>
            <button type="button" onClick={() => handleDelete(r.id)} className="text-xs text-red-500 hover:underline">
              삭제
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
