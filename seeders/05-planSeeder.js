exports.up = async ({ db }, mongoose) => {
  const { Plan } = db;
  try {
    const plans = [
      {
        name: 'Free Plan',
        slug: 'free-plan',
        description: 'Get started with basic AI features.',
        plan_type: 'subscription',
        billing_cycle: 'monthly',
        validity_days: 30,
        total_credits: 50,
        is_popular: false,
        status: 'active',
        amount: 0,
        currency: 'USD',
      },
      {
        name: 'Pro Plan',
        slug: 'pro-plan',
        description: 'Advanced features for power users.',
        plan_type: 'subscription',
        billing_cycle: 'monthly',
        validity_days: 30,
        total_credits: 500,
        is_popular: true,
        status: 'active',
        amount: 29,
        currency: 'USD',
      },
      {
        name: 'Enterprise Plan',
        slug: 'enterprise-plan',
        description: 'Unlimited access for teams.',
        plan_type: 'subscription',
        billing_cycle: 'monthly',
        validity_days: 30,
        total_credits: 2000,
        is_popular: false,
        status: 'active',
        amount: 99,
        currency: 'USD',
      }
    ];

    for (const planData of plans) {
      const existing = await Plan.findOne({ slug: planData.slug });
      if (!existing) {
        await new Plan(planData).save();
      }
    }

    console.log('Plans seeded successfully.');
  } catch (error) {
    console.error('Error seeding Plans:', error);
  }
};

exports.down = async ({ db }, mongoose) => {
  const { Plan } = db;
  try {
    await Plan.deleteMany({});
  } catch (error) {
    console.error('Error reverting Plan seeder:', error);
  }
};
