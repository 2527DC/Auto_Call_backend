'use strict';

// A contact who must not be called or messaged: blocked for policy reasons, or
// who asked not to be contacted (lead status "Do not call").
const isDoNotContact = (contact) => !!(contact && (contact.is_blocked || contact.lead?.status === 'do_not_call' || contact.lead?.dnc?.at));

module.exports = { isDoNotContact };
