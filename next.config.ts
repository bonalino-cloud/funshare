import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  productionBrowserSourceMaps: false,
};

export default withWorkflow(nextConfig);
