import type { Core } from '@strapi/strapi';

const destroy = ({ strapi }: { strapi: Core.Strapi }) => {
  // Cleanup when plugin is destroyed
};

export default destroy;
