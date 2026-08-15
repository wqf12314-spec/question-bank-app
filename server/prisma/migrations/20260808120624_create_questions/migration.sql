-- CreateTable
CREATE TABLE "Question" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "answer" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL DEFAULT '基础',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
