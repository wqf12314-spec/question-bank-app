-- CreateTable
CREATE TABLE "PracticeRecord" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "userAnswer" TEXT NOT NULL DEFAULT '',
    "result" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'write',
    "practicedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PracticeRecord_userId_practicedAt_idx" ON "PracticeRecord"("userId", "practicedAt");

-- CreateIndex
CREATE INDEX "PracticeRecord_questionId_idx" ON "PracticeRecord"("questionId");

-- AddForeignKey
ALTER TABLE "PracticeRecord" ADD CONSTRAINT "PracticeRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeRecord" ADD CONSTRAINT "PracticeRecord_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
