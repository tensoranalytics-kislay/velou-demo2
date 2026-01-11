import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkProductAgeGroups() {
  const productIds = [
    '8038485491897',
    '8043997135033',
    '8051735298233',
    '8097726857401',
    '8120573788345',
    '8179617136825'
  ];

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      title: true,
      ageGroup: true,
      category: true,
      subcategory: true,
      attributes: true
    }
  });

  console.log('\n' + '='.repeat(100));
  console.log('Products Recommended for "blue maxi dresses for kids"');
  console.log('='.repeat(100));

  products.forEach(p => {
    const attrs = p.attributes as any;
    console.log('\n' + '-'.repeat(100));
    console.log('Product:', p.title);
    console.log('ID:', p.id);
    console.log('ageGroup column:', p.ageGroup);
    console.log('category:', p.category);
    console.log('subcategory:', p.subcategory);
    console.log('attributes->ageGroup:', attrs?.ageGroup || attrs?.age_group);
    console.log('attributes->age_group:', attrs?.age_group);
    console.log('-'.repeat(100));
  });

  await prisma.$disconnect();
}

checkProductAgeGroups().catch(console.error);

const prisma = new PrismaClient();

async function checkProductAgeGroups() {
  const productIds = [
    '8038485491897',
    '8043997135033',
    '8051735298233',
    '8097726857401',
    '8120573788345',
    '8179617136825'
  ];

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      title: true,
      ageGroup: true,
      category: true,
      subcategory: true,
      attributes: true
    }
  });

  console.log('\n' + '='.repeat(100));
  console.log('Products Recommended for "blue maxi dresses for kids"');
  console.log('='.repeat(100));

  products.forEach(p => {
    const attrs = p.attributes as any;
    console.log('\n' + '-'.repeat(100));
    console.log('Product:', p.title);
    console.log('ID:', p.id);
    console.log('ageGroup column:', p.ageGroup);
    console.log('category:', p.category);
    console.log('subcategory:', p.subcategory);
    console.log('attributes->ageGroup:', attrs?.ageGroup || attrs?.age_group);
    console.log('attributes->age_group:', attrs?.age_group);
    console.log('-'.repeat(100));
  });

  await prisma.$disconnect();
}

checkProductAgeGroups().catch(console.error);
