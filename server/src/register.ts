import type { Core } from '@strapi/strapi';

const register = ({ strapi }: { strapi: Core.Strapi }) => {
  // Plugin registration - middleware is registered in bootstrap for proper initialization timing
};

export default register;
