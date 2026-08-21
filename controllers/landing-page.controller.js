const { db } = require('../models');
const LandingPage = db.LandingPage;
const mongoose = require('mongoose');

const extractId = (val) => {
  if (val && typeof val === 'object') {
    if (mongoose.Types.ObjectId.isValid(val._id)) return val._id;
    if (mongoose.Types.ObjectId.isValid(val.id)) return val.id;
  }
  if (mongoose.Types.ObjectId.isValid(val)) return val;
  return null;
};

const getPopulatedLandingPage = () => {
  return LandingPage.findOne()
    .populate('pricing.plan_ids')
    .populate({
      path: 'blog.blog_ids',
      select: 'title slug description thumbnail created_at',
      populate: [
        { path: 'categories', select: 'name' },
        { path: 'tags', select: 'name' }
      ]
    })
    .populate('testimonials.testimonial_ids')
    .populate('faq.faq_ids');
};

exports.getLandingPage = async (req, res) => {
  try {
    let landingPage = await getPopulatedLandingPage().lean({ virtuals: true });

    if (!landingPage) {
      const newPage = new LandingPage({});
      await newPage.save();
      landingPage = await getPopulatedLandingPage().lean({ virtuals: true });
    }

    return res.status(200).json({
      message: 'Landing page fetched successfully',
      landing_page: landingPage
    });
  } catch (error) {
    console.error('Get landing page error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateLandingPage = async (req, res) => {
  try {
    const body = req.body;
    const updateData = {};

    if (body.hero !== undefined) {
      const hero = typeof body.hero === 'string' ? JSON.parse(body.hero) : body.hero;
      updateData.hero = {};
      ['badge', 'heading', 'subheading', 'cta_primary_text', 'cta_secondary_text', 'cta_secondary_link', 'image'].forEach(f => {
        if (hero[f] !== undefined) updateData.hero[f] = hero[f] || null;
      });
    }

    if (body.primary_features !== undefined) {
      const pf = typeof body.primary_features === 'string' ? JSON.parse(body.primary_features) : body.primary_features;
      updateData.primary_features = {};
      ['badge', 'title', 'subtitle'].forEach(f => {
        if (pf[f] !== undefined) updateData.primary_features[f] = pf[f] || null;
      });
      if (pf.left_card) {
        updateData.primary_features.left_card = {
          title: pf.left_card.title || null,
          description: pf.left_card.description || null
        };
      }
      if (Array.isArray(pf.cards)) {
        updateData.primary_features.cards = pf.cards.map(c => ({
          key: c.key || null,
          title: c.title || null,
          description: c.description || null,
          image: c.image || null
        }));
      }
    }

    if (body.comparison !== undefined) {
      const comparison = typeof body.comparison === 'string' ? JSON.parse(body.comparison) : body.comparison;
      updateData.comparison = {};
      if (comparison.heading !== undefined) updateData.comparison.heading = comparison.heading || null;
      if (comparison.robotImage !== undefined) updateData.comparison.robotImage = comparison.robotImage || null;
      if (Array.isArray(comparison.features)) {
        updateData.comparison.features = comparison.features.map(f => String(f || ''));
      }
      if (Array.isArray(comparison.traditional)) {
        updateData.comparison.traditional = comparison.traditional.map(t => String(t || ''));
      }
      if (Array.isArray(comparison.aiAgents)) {
        updateData.comparison.aiAgents = comparison.aiAgents.map(a => String(a || ''));
      }
    }

    if (body.how_it_works !== undefined) {
      const hiw = typeof body.how_it_works === 'string' ? JSON.parse(body.how_it_works) : body.how_it_works;
      updateData.how_it_works = {};
      if (hiw.heading !== undefined) updateData.how_it_works.heading = hiw.heading || null;
      if (hiw.subtitle !== undefined) updateData.how_it_works.subtitle = hiw.subtitle || null;
      if (Array.isArray(hiw.steps)) {
        updateData.how_it_works.steps = hiw.steps.map(step => ({
          number: step.number || 1,
          title: step.title || null,
          description: step.description || null,
          icon: step.icon || 'UserPlus'
        }));
      }
    }

    if (body.automate !== undefined) {
      const automate = typeof body.automate === 'string' ? JSON.parse(body.automate) : body.automate;
      updateData.automate = {};
      if (automate.heading !== undefined) updateData.automate.heading = automate.heading || null;
      if (Array.isArray(automate.cards)) {
        updateData.automate.cards = automate.cards.map(card => ({
          title: card.title || null,
          description: card.description || null,
          icon: card.icon || 'Phone'
        }));
      }
    }

    if (body.addons !== undefined) {
      const addons = typeof body.addons === 'string' ? JSON.parse(body.addons) : body.addons;
      updateData.addons = {};
      ['badge', 'title', 'subtitle'].forEach(f => {
        if (addons[f] !== undefined) updateData.addons[f] = addons[f] || null;
      });
      if (Array.isArray(addons.cards)) {
        updateData.addons.cards = addons.cards.map(c => ({
          title: c.title || null,
          description: c.description || null,
          image: c.image || null,
          badges: Array.isArray(c.badges) ? c.badges : (typeof c.badges === 'string' ? c.badges.split(',').map(b => b.trim()).filter(b => b) : [])
        }));
      }
    }

    if (body.human_transfer !== undefined) {
      const ht = typeof body.human_transfer === 'string' ? JSON.parse(body.human_transfer) : body.human_transfer;
      updateData.human_transfer = {};
      ['badge', 'title', 'subtitle', 'description', 'image'].forEach(f => {
        if (ht[f] !== undefined) updateData.human_transfer[f] = ht[f] || null;
      });
      if (Array.isArray(ht.features)) {
        updateData.human_transfer.features = ht.features.map(f => ({
          title: f.title || null,
          description: f.description || null
        }));
      }
      if (Array.isArray(ht.bottom_features)) {
        updateData.human_transfer.bottom_features = ht.bottom_features.map(f => ({
          title: f.title || null,
          description: f.description || null
        }));
      }
    }

    if (body.pricing !== undefined) {
      const pricing = typeof body.pricing === 'string' ? JSON.parse(body.pricing) : body.pricing;
      updateData.pricing = {};
      ['badge', 'title', 'description'].forEach(f => {
        if (pricing[f] !== undefined) updateData.pricing[f] = pricing[f] || null;
      });
      if (Array.isArray(pricing.plan_ids)) {
        updateData.pricing.plan_ids = pricing.plan_ids.map(id => extractId(id)).filter(id => id);
      }
    }

    if (body.blog !== undefined) {
      const blog = typeof body.blog === 'string' ? JSON.parse(body.blog) : body.blog;
      updateData.blog = {};
      ['badge', 'title', 'description'].forEach(f => {
        if (blog[f] !== undefined) updateData.blog[f] = blog[f] || null;
      });
      if (Array.isArray(blog.blog_ids)) {
        updateData.blog.blog_ids = blog.blog_ids.map(id => extractId(id)).filter(id => id);
      }
    }

    if (body.testimonials !== undefined) {
      const testimonials = typeof body.testimonials === 'string' ? JSON.parse(body.testimonials) : body.testimonials;
      updateData.testimonials = {};
      ['section_badge', 'section_heading', 'section_subheading'].forEach(f => {
        if (testimonials[f] !== undefined) updateData.testimonials[f] = testimonials[f] || null;
      });
      if (Array.isArray(testimonials.testimonial_ids)) {
        updateData.testimonials.testimonial_ids = testimonials.testimonial_ids.map(id => extractId(id)).filter(id => id);
      }
    }

    if (body.faq !== undefined) {
      const faq = typeof body.faq === 'string' ? JSON.parse(body.faq) : body.faq;
      updateData.faq = {};
      ['section_badge', 'section_heading', 'section_subheading'].forEach(f => {
        if (faq[f] !== undefined) updateData.faq[f] = faq[f] || null;
      });
      if (Array.isArray(faq.faq_ids)) {
        updateData.faq.faq_ids = faq.faq_ids.map(id => extractId(id)).filter(id => id);
      }
    }

    if (body.contact !== undefined) {
      const contact = typeof body.contact === 'string' ? JSON.parse(body.contact) : body.contact;
      updateData.contact = {};
      ['section_badge', 'heading', 'subheading', 'email', 'phone', 'address', 'live_chat_label'].forEach(f => {
        if (contact[f] !== undefined) updateData.contact[f] = contact[f] || null;
      });
    }

    if (body.footer !== undefined) {
      const footer = typeof body.footer === 'string' ? JSON.parse(body.footer) : body.footer;
      updateData.footer = {};
      ['tagline', 'copyright', 'address', 'phone', 'email'].forEach(f => {
        if (footer[f] !== undefined) updateData.footer[f] = footer[f] || null;
      });
      if (Array.isArray(footer.social_links)) {
        updateData.footer.social_links = footer.social_links.map(s => ({
          name: s.name || null,
          href: s.href || '#',
          icon: s.icon || null
        }));
      }
    }

    await LandingPage.updateOne({}, { $set: updateData }, { upsert: true });

    const updated = await getPopulatedLandingPage().lean({ virtuals: true });

    return res.status(200).json({
      message: 'Landing page updated successfully',
      landing_page: updated
    });
  } catch (error) {
    console.error('Update landing page error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
