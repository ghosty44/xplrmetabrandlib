import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.brand.upsert({
    where: { metaPageId: "10936503735" },
    update: {},
    create: {
      name: "ASOS",
      metaPageId: "10936503735",
      category: "Mode",
      isFollowing: true,
    },
  });
  console.log("Seeded: ASOS");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
