import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const boards = await prisma.board.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(boards);
  } catch (error) {
    console.error("GET /api/boards error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name } = body;
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const board = await prisma.board.create({ data: { name } });
    return NextResponse.json(board, { status: 201 });
  } catch (error) {
    console.error("POST /api/boards error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
