-- AlterTable: Add new columns to Document table
ALTER TABLE "Document" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'branch';
ALTER TABLE "Document" ADD COLUMN "expiresAt" TIMESTAMP(3);

-- CreateTable: DocumentPermission
CREATE TABLE "DocumentPermission" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT,
    "branchId" TEXT,
    "permission" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentPermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentPermission_documentId_userId_branchId_key" ON "DocumentPermission"("documentId", "userId", "branchId");

-- CreateIndex
CREATE INDEX "DocumentPermission_documentId_idx" ON "DocumentPermission"("documentId");

-- CreateIndex
CREATE INDEX "DocumentPermission_userId_idx" ON "DocumentPermission"("userId");

-- CreateIndex
CREATE INDEX "DocumentPermission_branchId_idx" ON "DocumentPermission"("branchId");

-- CreateIndex
CREATE INDEX "DocumentPermission_expiresAt_idx" ON "DocumentPermission"("expiresAt");

-- CreateIndex
CREATE INDEX "Document_visibility_idx" ON "Document"("visibility");

-- CreateIndex
CREATE INDEX "Document_expiresAt_idx" ON "Document"("expiresAt");

-- AddForeignKey
ALTER TABLE "DocumentPermission" ADD CONSTRAINT "DocumentPermission_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPermission" ADD CONSTRAINT "DocumentPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPermission" ADD CONSTRAINT "DocumentPermission_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
