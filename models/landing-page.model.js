const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const SocialLinkSchema = new Schema({
  name: { type: String, default: null },
  href: { type: String, default: '#' },
  icon: { type: String, default: null }
}, { _id: true });

const HowItWorksStepSchema = new Schema({
  number: { type: Number, default: 1 },
  title: { type: String, default: null },
  description: { type: String, default: null },
  icon: { type: String, default: 'UserPlus' }
}, { _id: true });

const AutomateCardSchema = new Schema({
  title: { type: String, default: null },
  description: { type: String, default: null },
  icon: { type: String, default: 'Phone' }
}, { _id: true });

const AddonsCardSchema = new Schema({
  title: { type: String, default: null },
  description: { type: String, default: null },
  image: { type: String, default: null },
  badges: [{ type: String }]
}, { _id: true });

const HumanTransferFeatureSchema = new Schema({
  title: { type: String, default: null },
  description: { type: String, default: null }
}, { _id: true });

const LandingPageSchema = new Schema(
  {
    hero: {
      badge: { type: String, default: 'New: Voice Calling AI v2.0' },
      heading: { type: String, default: 'AI Voice Agents That Call, Qualify, Book & Follow Up' },
      subheading: { type: String, default: null },
      cta_primary_text: { type: String, default: "Let's Talk" },
      cta_secondary_text: { type: String, default: 'View Documentation' },
      cta_secondary_link: { type: String, default: 'https://docs.pixelstrap.net/autocall' },
      image: { type: String, default: null },
    },
    primary_features: {
      badge: { type: String, default: 'Platform Core' },
      title: { type: String, default: 'Turn Conversations Into Customers' },
      subtitle: { type: String, default: null },
      left_card: {
        title: { type: String, default: null },
        description: { type: String, default: null },
        image: { type: String, default: null }
      },
      cards: [{
        key: { type: String, default: null },
        title: { type: String, default: null },
        description: { type: String, default: null },
        image: { type: String, default: null }
      }]
    },

    comparison: {
      heading: { type: String, default: 'Turn Every Call Into an Opportunity with AI' },
      features: [{ type: String }],
      traditional: [{ type: String }],
      aiAgents: [{ type: String }],
      robotImage: { type: String, default: null }
    },

    how_it_works: {
      heading: { type: String, default: 'How AutoCall Works' },
      subtitle: { type: String, default: 'A seamless journey from setup to results, designed for your growth.' },
      steps: {
        type: [HowItWorksStepSchema],
        validate: [arr => arr.length <= 3, 'Maximum 3 steps are allowed']
      }
    },

    automate: {
      heading: { type: String, default: 'Automate Customer Engagement at Scale' },
      cards: [AutomateCardSchema]
    },

    addons: {
      badge: { type: String, default: 'Add-ons' },
      title: { type: String, default: 'Powerful Add-ons for Your Business' },
      subtitle: { type: String, default: 'Extend your platform capabilities with seamless integrations, advanced communication channels, and scalable management tools.' },
      cards: [AddonsCardSchema]
    },

    human_transfer: {
      badge: { type: String, default: 'Human Transfer' },
      title: { type: String, default: 'Smart conversations.' },
      subtitle: { type: String, default: 'Seamless human connection.' },
      description: { type: String, default: 'Enable human transfer in your AI agents and let important conversations flow to the right team member—instantly.' },
      image: { type: String, default: null },
      features: [HumanTransferFeatureSchema],
      bottom_features: [HumanTransferFeatureSchema]
    },

    pricing: {
      badge: { type: String, default: 'Pricing Plans' },
      title: { type: String, default: 'Choose the Right Plan' },
      description: { type: String, default: null },
      plan_ids: [{ type: Schema.Types.ObjectId, ref: 'Plan' }]
    },

    blog: {
      badge: { type: String, default: 'News & Insights' },
      title: { type: String, default: 'Insights for Smarter Customer Engagement' },
      description: { type: String, default: null },
      blog_ids: [{ type: Schema.Types.ObjectId, ref: 'Blog' }]
    },

    testimonials: {
      section_badge: { type: String, default: 'Customer Stories' },
      section_heading: { type: String, default: 'What Our Clients Say' },
      section_subheading: { type: String, default: null },
      testimonial_ids: [{ type: Schema.Types.ObjectId, ref: 'Testimonial' }]
    },

    faq: {
      section_badge: { type: String, default: 'Questions and Answers' },
      section_heading: { type: String, default: 'Frequently asked questions' },
      section_subheading: { type: String, default: null },
      faq_ids: [{ type: Schema.Types.ObjectId, ref: 'Faq' }]
    },

    contact: {
      section_badge: { type: String, default: "We're Online" },
      heading: { type: String, default: "Let's build something incredible together" },
      subheading: { type: String, default: null },
      email: { type: String, default: 'support@autocall.com' },
      phone: { type: String, default: null },
      address: { type: String, default: null },
      live_chat_label: { type: String, default: 'Available 24/7' }
    },

    footer: {
      tagline: { type: String, default: null },
      copyright: { type: String, default: '© 2025 Autocall AI. All Rights Reserved.' },
      address: { type: String, default: null },
      phone: { type: String, default: null },
      email: { type: String, default: 'support@autocall.com' },
      social_links: [SocialLinkSchema]
    }
  },
  {
    collection: 'landing_page',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(LandingPageSchema);

module.exports = mongoose.model('LandingPage', LandingPageSchema);
