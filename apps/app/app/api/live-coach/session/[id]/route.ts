import { NextResponse } from "next/server";
import { getLiveCoachSession, LiveCoachNotConfiguredError } from "@/lib/live-coach-client";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await getLiveCoachSession(id);
    return NextResponse.json(result.data, { status: result.status });
  } catch (err) {
    if (err instanceof LiveCoachNotConfiguredError) {
      return NextResponse.json({ error: "live coach is not configured yet" }, { status: 503 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
