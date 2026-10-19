import { nanobotHealth } from "@/lib/nanobot/client";

/**
 * Tiny liveness pill so "analysis failed" is never confused with
 * "the agent isn't running".
 */
export async function EngineStatus() {
  const online = await nanobotHealth();

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        online
          ? "bg-emerald-100 text-emerald-800"
          : "bg-gray-100 text-gray-500"
      }`}
      title={
        online
          ? "nanobot API is reachable"
          : "nanobot is not reachable — run `nanobot serve`"
      }
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          online ? "bg-emerald-500" : "bg-gray-400"
        }`}
      />
      nanobot {online ? "online" : "offline"}
    </span>
  );
}
