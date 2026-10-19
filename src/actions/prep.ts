"use server";

import { getSessionUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import {
  generateCompanySnapshot,
  generateInterviewPrep,
  generateBehavioralQuestions,
} from "@/lib/llm/prep";

export async function generateSnapshot(applicationId: string) {
  const user = await getSessionUser();
  if (!user) throw new Error("Unauthorized");

  const app = await prisma.application.findFirst({
    where: { id: applicationId, userId: user.id },
  });
  if (!app) throw new Error("Application not found");

  const snapshot = await generateCompanySnapshot(app.company, app.role, user.id);
  if (!snapshot) throw new Error("Failed to generate company snapshot");

  await prisma.companyPrep.upsert({
    where: { applicationId },
    create: {
      applicationId,
      snapshotJson: JSON.stringify(snapshot),
      snapshotGeneratedAt: new Date(),
    },
    update: {
      snapshotJson: JSON.stringify(snapshot),
      snapshotGeneratedAt: new Date(),
    },
  });

  revalidatePath(`/applications/${applicationId}`);
  return snapshot;
}

export async function generateInterviewPrepAction(applicationId: string) {
  const user = await getSessionUser();
  if (!user) throw new Error("Unauthorized");

  const app = await prisma.application.findFirst({
    where: { id: applicationId, userId: user.id },
  });
  if (!app) throw new Error("Application not found");

  const prep = await generateInterviewPrep(app.company, app.role, user.id);
  if (!prep) throw new Error("Failed to generate interview prep");

  await prisma.companyPrep.upsert({
    where: { applicationId },
    create: {
      applicationId,
      interviewPrepJson: JSON.stringify(prep),
      prepGeneratedAt: new Date(),
    },
    update: {
      interviewPrepJson: JSON.stringify(prep),
      prepGeneratedAt: new Date(),
    },
  });

  revalidatePath(`/applications/${applicationId}`);
  return prep;
}

export async function generateQuestionsAction(applicationId: string) {
  const user = await getSessionUser();
  if (!user) throw new Error("Unauthorized");

  const app = await prisma.application.findFirst({
    where: { id: applicationId, userId: user.id },
  });
  if (!app) throw new Error("Application not found");

  const result = await generateBehavioralQuestions(app.company, app.role, user.id);
  if (!result) throw new Error("Failed to generate questions");

  await prisma.behavioralQuestion.deleteMany({
    where: { applicationId, userAnswer: null },
  });

  for (let i = 0; i < result.questions.length; i++) {
    await prisma.behavioralQuestion.create({
      data: {
        applicationId,
        question: result.questions[i].question,
        rationale: result.questions[i].rationale,
        sortOrder: i,
      },
    });
  }

  revalidatePath(`/applications/${applicationId}`);
  return result;
}
