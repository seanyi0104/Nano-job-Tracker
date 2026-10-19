"use server";

import { getSessionUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function saveAnswer(questionId: string, answer: string) {
  const user = await getSessionUser();
  if (!user) throw new Error("Unauthorized");

  const question = await prisma.behavioralQuestion.findFirst({
    where: { id: questionId },
    include: { application: { select: { userId: true, id: true } } },
  });

  if (!question || question.application.userId !== user.id) {
    throw new Error("Question not found");
  }

  await prisma.behavioralQuestion.update({
    where: { id: questionId },
    data: { userAnswer: answer || null },
  });

  revalidatePath(`/applications/${question.application.id}`);
}
