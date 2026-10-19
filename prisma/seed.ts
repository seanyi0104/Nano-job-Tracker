import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_EMAIL = "demo@jobtracker.local";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function main() {
  const existing = await prisma.user.findUnique({
    where: { email: DEMO_EMAIL },
    include: { applications: { select: { id: true } } },
  });

  if (existing && existing.applications.length > 0) {
    console.log("Demo data already seeded, skipping.");
    return;
  }

  const user =
    existing ??
    (await prisma.user.create({
      data: { email: DEMO_EMAIL, name: "Demo Student" },
    }));

  await prisma.syncState.upsert({
    where: { userId: user.id },
    create: { userId: user.id, lastSyncedAt: daysAgo(1), status: "idle" },
    update: { lastSyncedAt: daysAgo(1), status: "idle" },
  });

  // ── Amazon — SDE Intern, interviewing, with full prep content ──
  const amazon = await prisma.application.create({
    data: {
      userId: user.id,
      company: "Amazon",
      companyNormalized: "amazon",
      role: "Software Development Engineer Intern",
      roleNormalized: "software development engineer intern",
      status: "INTERVIEW",
      appliedDate: daysAgo(45),
      lastEmailDate: daysAgo(3),
    },
  });

  await prisma.email.createMany({
    data: [
      {
        userId: user.id,
        applicationId: amazon.id,
        gmailId: "demo-amazon-1",
        threadId: "demo-thread-amazon-1",
        fromAddress: "no-reply@amazon.com",
        subject: "Thank you for applying to Amazon!",
        snippet:
          "Thank you for applying for Software Development Engineer Intern at Amazon. We have received your application and will review it shortly.",
        internalDate: daysAgo(45),
        bodyText:
          "Thank you for applying for Software Development Engineer Intern (Summer 2026) at Amazon. We have received your application and will review it shortly. You will hear from us within 2-3 weeks.",
        isJobRelated: true,
        emailType: "applied",
        classifiedAt: daysAgo(44),
        extractedAt: daysAgo(44),
      },
      {
        userId: user.id,
        applicationId: amazon.id,
        gmailId: "demo-amazon-2",
        threadId: "demo-thread-amazon-2",
        fromAddress: "no-reply@hackerrankforwork.com",
        subject: "Amazon SDE Intern - Online Assessment Invitation",
        snippet:
          "Congratulations! You've been invited to complete the Amazon online assessment. You have 7 days to complete it.",
        internalDate: daysAgo(30),
        bodyText:
          "Congratulations! You've been invited to complete the Amazon SDE Intern online assessment. The assessment consists of two coding questions and a work simulation. You have 7 days to complete it.",
        isJobRelated: true,
        emailType: "oa",
        classifiedAt: daysAgo(29),
        extractedAt: daysAgo(29),
      },
      {
        userId: user.id,
        applicationId: amazon.id,
        gmailId: "demo-amazon-3",
        threadId: "demo-thread-amazon-3",
        fromAddress: "recruiting@amazon.com",
        subject: "Amazon Interview Confirmation - Final Round",
        snippet:
          "Your final round interview has been scheduled. You will meet with two engineers for a technical and behavioral interview.",
        internalDate: daysAgo(3),
        bodyText:
          "Your final round interview for Software Development Engineer Intern has been scheduled for next week. You will meet with two engineers: a 45-minute technical interview covering data structures and algorithms, followed by a 45-minute behavioral interview based on Amazon's Leadership Principles.",
        isJobRelated: true,
        emailType: "interview",
        classifiedAt: daysAgo(3),
        extractedAt: daysAgo(3),
      },
    ],
  });

  await prisma.companyPrep.create({
    data: {
      applicationId: amazon.id,
      snapshotGeneratedAt: daysAgo(2),
      prepGeneratedAt: daysAgo(2),
      snapshotJson: JSON.stringify({
        culture:
          "Amazon's engineering culture is built around ownership and operating at scale. Teams are small ('two-pizza teams'), move independently, and engineers are expected to own their services end-to-end — from design through production operations.",
        values: [
          "Customer Obsession",
          "Ownership",
          "Bias for Action",
          "Dive Deep",
          "Deliver Results",
        ],
        engineeringFocus:
          "Distributed systems at massive scale: AWS cloud infrastructure, e-commerce platforms, supply chain optimization, and increasingly generative AI services.",
        interviewThemes: [
          "Leadership Principles woven into every interview round",
          "Data structures and algorithms (arrays, trees, graphs, hash maps)",
          "System design fundamentals for intern level",
          "STAR-format behavioral answers with measurable impact",
        ],
      }),
      interviewPrepJson: JSON.stringify({
        processOverview:
          "Amazon's intern process typically has three stages: an online assessment with two coding questions and a work-style simulation, followed by one or two virtual interviews combining coding and Leadership Principles behavioral questions.",
        stages: [
          {
            name: "Online Assessment",
            description:
              "Two coding problems (usually arrays, strings, or hash maps) plus a work simulation. Complete within 7 days of receiving the invite.",
          },
          {
            name: "Technical Interview",
            description:
              "45 minutes with an engineer. One or two coding problems in a shared editor, with emphasis on explaining your approach and handling edge cases.",
          },
          {
            name: "Behavioral Interview",
            description:
              "45 minutes focused on Amazon's Leadership Principles. Expect 'Tell me about a time...' questions requiring STAR-format answers.",
          },
        ],
        checklist: [
          "Review Amazon's 16 Leadership Principles and map a story to each of the top 8",
          "Practice medium-difficulty LeetCode problems on arrays, strings, and hash maps",
          "Prepare 5-6 STAR stories with quantified results",
          "Practice explaining your thought process out loud while coding",
          "Review time/space complexity analysis for common algorithms",
          "Prepare questions to ask your interviewers about their team",
        ],
      }),
    },
  });

  await prisma.behavioralQuestion.createMany({
    data: [
      {
        applicationId: amazon.id,
        sortOrder: 0,
        question:
          "Tell me about a time you took ownership of a project beyond what was expected of you.",
        rationale:
          "Ownership is one of Amazon's most emphasized Leadership Principles — they want engineers who act on behalf of the whole company, not just their task.",
        userAnswer:
          "In my software engineering class project, our team's backend developer dropped the course mid-semester. I took over the API layer in addition to my frontend work, set up CI so we'd catch breakages early, and we shipped on time with all features. I learned to flag risks early and redistribute work before it becomes a crisis.",
      },
      {
        applicationId: amazon.id,
        sortOrder: 1,
        question:
          "Tell me about a time you had to make a decision with incomplete information.",
        rationale:
          "Maps to 'Bias for Action' — Amazon values calculated risk-taking since speed matters in business.",
      },
      {
        applicationId: amazon.id,
        sortOrder: 2,
        question:
          "Describe a time you disagreed with a teammate. How did you resolve it?",
        rationale:
          "Tests 'Have Backbone; Disagree and Commit' — Amazon wants people who challenge decisions respectfully, then commit fully once a decision is made.",
      },
      {
        applicationId: amazon.id,
        sortOrder: 3,
        question:
          "Tell me about a time you failed. What did you learn from it?",
        rationale:
          "Amazon interviewers probe for self-awareness and growth mindset ('Learn and Be Curious'). Authentic failures with concrete lessons score better than humble-brags.",
      },
      {
        applicationId: amazon.id,
        sortOrder: 4,
        question:
          "Tell me about a time you went above and beyond for a customer or user.",
        rationale:
          "Customer Obsession is Amazon's first and most important Leadership Principle — expect at least one question directly about it.",
      },
    ],
  });

  // ── Google — SWE Intern, OA stage ──
  const google = await prisma.application.create({
    data: {
      userId: user.id,
      company: "Google",
      companyNormalized: "google",
      role: "Software Engineer Intern",
      roleNormalized: "software engineer intern",
      status: "OA",
      appliedDate: daysAgo(20),
      lastEmailDate: daysAgo(5),
    },
  });

  await prisma.email.createMany({
    data: [
      {
        userId: user.id,
        applicationId: google.id,
        gmailId: "demo-google-1",
        threadId: "demo-thread-google-1",
        fromAddress: "no-reply@google.com",
        subject: "We received your application - Software Engineer Intern",
        snippet:
          "Thank you for your interest in Google. This email confirms we received your application for Software Engineer Intern, Summer 2026.",
        internalDate: daysAgo(20),
        bodyText:
          "Thank you for your interest in Google. This email confirms we received your application for Software Engineer Intern, Summer 2026. Our recruiting team will review your application and reach out if there is a match.",
        isJobRelated: true,
        emailType: "applied",
        classifiedAt: daysAgo(19),
        extractedAt: daysAgo(19),
      },
      {
        userId: user.id,
        applicationId: google.id,
        gmailId: "demo-google-2",
        threadId: "demo-thread-google-2",
        fromAddress: "codesignal@google.com",
        subject: "Google Online Coding Assessment - Action Required",
        snippet:
          "You have been invited to take Google's online coding assessment. Please complete it within 5 business days.",
        internalDate: daysAgo(5),
        bodyText:
          "Congratulations! You have been invited to take Google's online coding assessment for the Software Engineer Intern position. The assessment contains two coding questions to be completed in 90 minutes. Please complete it within 5 business days.",
        isJobRelated: true,
        emailType: "oa",
        classifiedAt: daysAgo(5),
        extractedAt: daysAgo(5),
      },
    ],
  });

  // ── Meta — SWE Intern, rejected ──
  const meta = await prisma.application.create({
    data: {
      userId: user.id,
      company: "Meta",
      companyNormalized: "meta",
      role: "Software Engineer Intern",
      roleNormalized: "software engineer intern",
      status: "REJECTED",
      appliedDate: daysAgo(60),
      lastEmailDate: daysAgo(15),
    },
  });

  await prisma.email.createMany({
    data: [
      {
        userId: user.id,
        applicationId: meta.id,
        gmailId: "demo-meta-1",
        threadId: "demo-thread-meta-1",
        fromAddress: "recruiting@fb.com",
        subject: "Your Meta Application Confirmation",
        snippet:
          "Hi! Thanks for applying to the Software Engineer Intern position at Meta. We'll be in touch soon.",
        internalDate: daysAgo(60),
        bodyText:
          "Hi! Thanks for applying to the Software Engineer Intern position at Meta. Our team reviews applications on a rolling basis and we'll be in touch soon.",
        isJobRelated: true,
        emailType: "applied",
        classifiedAt: daysAgo(59),
        extractedAt: daysAgo(59),
      },
      {
        userId: user.id,
        applicationId: meta.id,
        gmailId: "demo-meta-2",
        threadId: "demo-thread-meta-2",
        fromAddress: "recruiting@fb.com",
        subject: "Update on your Meta application",
        snippet:
          "Thank you for your interest in Meta. After careful consideration, we have decided not to move forward with your application at this time.",
        internalDate: daysAgo(15),
        bodyText:
          "Thank you for your interest in Meta and for the time you invested in your application. After careful consideration, we have decided not to move forward with your application at this time. We encourage you to apply again in the future.",
        isJobRelated: true,
        emailType: "rejection",
        classifiedAt: daysAgo(15),
        extractedAt: daysAgo(15),
      },
    ],
  });

  // ── Stripe — Backend Intern, applied ──
  const stripe = await prisma.application.create({
    data: {
      userId: user.id,
      company: "Stripe",
      companyNormalized: "stripe",
      role: "Backend Engineer Intern",
      roleNormalized: "backend engineer intern",
      status: "APPLIED",
      appliedDate: daysAgo(10),
      lastEmailDate: daysAgo(10),
    },
  });

  await prisma.email.create({
    data: {
      userId: user.id,
      applicationId: stripe.id,
      gmailId: "demo-stripe-1",
      threadId: "demo-thread-stripe-1",
      fromAddress: "no-reply@greenhouse.io",
      subject: "Thank you for applying to Stripe",
      snippet:
        "Thank you for applying to the Backend Engineer Intern role at Stripe. We've received your application.",
      internalDate: daysAgo(10),
      bodyText:
        "Thank you for applying to the Backend Engineer Intern role at Stripe. We've received your application and our recruiting team will review it. We aim to respond within two weeks.",
      isJobRelated: true,
      emailType: "applied",
      classifiedAt: daysAgo(9),
      extractedAt: daysAgo(9),
    },
  });

  // ── Databricks — offer! ──
  const databricks = await prisma.application.create({
    data: {
      userId: user.id,
      company: "Databricks",
      companyNormalized: "databricks",
      role: "Software Engineering Intern",
      roleNormalized: "software engineering intern",
      status: "OFFER",
      appliedDate: daysAgo(75),
      lastEmailDate: daysAgo(2),
    },
  });

  await prisma.email.createMany({
    data: [
      {
        userId: user.id,
        applicationId: databricks.id,
        gmailId: "demo-databricks-1",
        threadId: "demo-thread-databricks-1",
        fromAddress: "university@databricks.com",
        subject: "Databricks Application Received",
        snippet:
          "Thanks for applying to the Software Engineering Intern position at Databricks!",
        internalDate: daysAgo(75),
        bodyText:
          "Thanks for applying to the Software Engineering Intern position at Databricks! We review applications on a rolling basis.",
        isJobRelated: true,
        emailType: "applied",
        classifiedAt: daysAgo(74),
        extractedAt: daysAgo(74),
      },
      {
        userId: user.id,
        applicationId: databricks.id,
        gmailId: "demo-databricks-2",
        threadId: "demo-thread-databricks-2",
        fromAddress: "university@databricks.com",
        subject: "Congratulations - Databricks Internship Offer!",
        snippet:
          "We are thrilled to extend you an offer to join Databricks as a Software Engineering Intern this summer!",
        internalDate: daysAgo(2),
        bodyText:
          "We are thrilled to extend you an offer to join Databricks as a Software Engineering Intern this summer! Your offer letter is attached. Please respond within two weeks. We can't wait to have you on the team!",
        isJobRelated: true,
        emailType: "offer",
        classifiedAt: daysAgo(2),
        extractedAt: daysAgo(2),
      },
    ],
  });

  // ── Anduril — recruiter outreach, applied ──
  const anduril = await prisma.application.create({
    data: {
      userId: user.id,
      company: "Anduril",
      companyNormalized: "anduril",
      role: "Software Engineer Intern",
      roleNormalized: "software engineer intern",
      status: "APPLIED",
      appliedDate: daysAgo(7),
      lastEmailDate: daysAgo(7),
    },
  });

  await prisma.email.create({
    data: {
      userId: user.id,
      applicationId: anduril.id,
      gmailId: "demo-anduril-1",
      threadId: "demo-thread-anduril-1",
      fromAddress: "recruiter@anduril.com",
      subject: "Your background caught our eye - Anduril SWE Internship",
      snippet:
        "Hi! I came across your profile and think you'd be a great fit for our Software Engineer Intern role.",
      internalDate: daysAgo(7),
      bodyText:
        "Hi! I came across your profile and think you'd be a great fit for our Software Engineer Intern role at Anduril. We're building autonomous defense systems and looking for strong systems programmers. Would you be open to a quick chat this week?",
      isJobRelated: true,
      emailType: "recruiter_outreach",
      classifiedAt: daysAgo(6),
      extractedAt: daysAgo(6),
    },
  });

  console.log("Seeded demo data:");
  console.log("  - 6 applications (Amazon, Google, Meta, Stripe, Databricks, Anduril)");
  console.log("  - 11 emails");
  console.log("  - Amazon has full prep content + 5 behavioral questions (1 answered)");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
