import { db } from './index.js';
import { domains } from './schema.js';

/**
 * Default domains for the Life Manager system
 * 
 * These domains represent the core life areas that the system helps balance.
 * The boringButImportant flag indicates domains that users tend to avoid but need to do.
 */
const defaultDomains = [
  {
    name: 'Health',
    description: 'Physical and mental wellbeing, exercise, sleep, nutrition, medical appointments',
    whyItMatters: 'Health is the foundation for everything else. Without it, nothing else works.',
    boringButImportant: false, // Health is important but usually not boring
  },
  {
    name: 'Uni / Research',
    description: 'University coursework, research projects, academic reading, thesis work',
    whyItMatters: 'Academic work builds knowledge, skills, and opens future opportunities.',
    boringButImportant: false, // Usually engaging for students
  },
  {
    name: 'Admin',
    description: 'Bills, emails, paperwork, appointments, bureaucracy, life maintenance',
    whyItMatters: 'Admin tasks prevent crises and keep life running smoothly. Neglecting them creates stress.',
    boringButImportant: true, // Classic boring-but-important domain
  },
  {
    name: 'Creative Projects',
    description: 'Personal projects, hobbies, art, writing, building things for joy',
    whyItMatters: 'Creative work brings joy, meaning, and self-expression. It\'s not optional for wellbeing.',
    boringButImportant: false, // Creative work is usually intrinsically motivating
  },
  {
    name: 'Relationships',
    description: 'Time with friends, family, partner, social connection, reaching out',
    whyItMatters: 'Social connection reduces mortality by 50%. Love is integration. This is survival, not luxury.',
    boringButImportant: false, // Important and usually rewarding, though can feel hard when isolated
  },
];

/**
 * Seed the database with default domains
 * 
 * This function is idempotent - it only inserts domains that don't already exist.
 * Domains are matched by name (which has a unique constraint).
 * 
 * @returns The number of domains inserted
 */
export async function seedDefaultDomains(): Promise<number> {
  const now = new Date().toISOString();
  let insertedCount = 0;

  for (const domain of defaultDomains) {
    try {
      // Check if domain already exists
      const existing = await db.query.domains.findFirst({
        where: (domains, { eq }) => eq(domains.name, domain.name),
      });

      if (!existing) {
        // Insert new domain
        await db.insert(domains).values({
          ...domain,
          createdAt: now,
          updatedAt: now,
        });
        insertedCount++;
        console.log(`✅ Seeded domain: ${domain.name}`);
      } else {
        console.log(`⏭️  Domain already exists: ${domain.name}`);
      }
    } catch (error) {
      console.error(`❌ Failed to seed domain "${domain.name}":`, error);
      throw error;
    }
  }

  return insertedCount;
}

/**
 * Main seed function
 * Call this to seed all default data
 */
export async function seed() {
  console.log('🌱 Starting database seed...');
  
  const domainsInserted = await seedDefaultDomains();
  
  console.log(`\n✅ Seed complete! Inserted ${domainsInserted} new domains.`);
}

// Allow running this file directly for manual seeding
// Run seed when this file is executed directly
seed()
  .then(() => {
    console.log('Seed completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });
