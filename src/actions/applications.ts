"use server";

import { getSessionUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { APPLICATION_STATUSES } from "@/lib/types";
import { redirect } from "next/navigation";

export async function updateApplicationStatus(
  applicationId: string,
  status: string
) {
  const user = await getSessionUser();
  if (!user) throw new Error("Unauthorized");

  if (!APPLICATION_STATUSES.includes(status as never)) {
    throw new Error("Invalid status");
  }

  const app = await prisma.application.findFirst({
    where: { id: applicationId, userId: user.id },
  });

  if (!app) throw new Error("Application not found");

  await prisma.application.update({
    where: { id: applicationId },
    data: { status, statusIsManual: true },
  });

  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/");
}

export async function deleteApplication(applicationId: string) {
  const user = await getSessionUser();
  if (!user) throw new Error("Unauthorized");

  const app = await prisma.application.findFirst({
    where: { id: applicationId, userId: user.id },
  });

  if (!app) throw new Error("Application not found");

  await prisma.email.updateMany({
    where: { applicationId },
    data: { applicationId: null },
  });

  await prisma.application.delete({ where: { id: applicationId } });

  revalidatePath("/");
  redirect("/");
}
