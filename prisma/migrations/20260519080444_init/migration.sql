-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metaPageId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "isFollowing" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ad" (
    "id" TEXT NOT NULL,
    "metaAdId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "snapshotUrl" TEXT,
    "bodyText" TEXT,
    "linkTitle" TEXT,
    "linkDescription" TEXT,
    "platforms" TEXT,
    "activeSince" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Board" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardAd" (
    "boardId" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardAd_pkey" PRIMARY KEY ("boardId","adId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_metaPageId_key" ON "Brand"("metaPageId");

-- CreateIndex
CREATE UNIQUE INDEX "Ad_metaAdId_key" ON "Ad"("metaAdId");

-- AddForeignKey
ALTER TABLE "Ad" ADD CONSTRAINT "Ad_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardAd" ADD CONSTRAINT "BoardAd_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardAd" ADD CONSTRAINT "BoardAd_adId_fkey" FOREIGN KEY ("adId") REFERENCES "Ad"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

