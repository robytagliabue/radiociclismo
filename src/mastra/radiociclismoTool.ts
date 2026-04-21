import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import axios from "axios";

export const loginRadiociclismoTool = createTool({
  id: "login-radiociclismo",
  description:
    "Logs into the Radiociclismo admin panel and returns the session cookie for authenticated API calls.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    sessionCookie: z.string(),
    success: z.boolean(),
  }),
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔐 [loginRadiociclismo] Logging into Radiociclismo admin...");

    try {
      const username = process.env.RC_USERNAME;
      const password = process.env.RC_PASSWORD;

      if (!username || !password) {
        logger?.error("❌ [loginRadiociclismo] Missing RC_USERNAME or RC_PASSWORD");
        return { sessionCookie: "", success: false };
      }

      const response = await axios.post(
        "https://radiociclismo.com/api/admin/login",
        { username, password },
        {
          headers: { "Content-Type": "application/json" },
          withCredentials: true,
          maxRedirects: 0,
          validateStatus: (s) => s < 400,
        },
      );

      const cookies = response.headers["set-cookie"] || [];
      let sessionCookie = "";

      for (const cookie of cookies) {
        if (cookie.includes("connect.sid")) {
          sessionCookie = cookie.split(";")[0];
          break;
        }
      }

      if (!sessionCookie && cookies.length > 0) {
        sessionCookie = cookies[0].split(";")[0];
      }

      logger?.info(
        `${sessionCookie ? "✅" : "❌"} [loginRadiociclismo] Login ${sessionCookie ? "successful" : "failed - no session cookie"}`,
      );

      return { sessionCookie, success: !!sessionCookie };
    } catch (error) {
      logger?.error("❌ [loginRadiociclismo] Login error", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { sessionCookie: "", success: false };
    }
  },
});

export const createArticleTool = createTool({
  id: "create-article",
  description:
    "Creates a new article on Radiociclismo.com using the admin API. Requires a valid session cookie from login.",
  inputSchema: z.object({
    sessionCookie: z.string().describe("The connect.sid session cookie from login"),
    slug: z.string().describe("URL-friendly slug for the article"),
    titleIt: z.string().describe("Italian title"),
    excerptIt: z.string().describe("Italian excerpt/preview"),
    contentIt: z.string().describe("Italian HTML content"),
    titleEn: z.string().describe("English title"),
    excerptEn: z.string().describe("English excerpt/preview"),
    contentEn: z.string().describe("English HTML content"),
    imageUrl: z.string().describe("URL of the featured image"),
    author: z.string().describe("Author name"),
    hashtags: z.string().describe("Comma-separated hashtags"),
  }),
  outputSchema: z.object({
    articleId: z.string(),
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info(`📝 [createArticle] Creating article: ${context.titleIt}`);

    try {
      const articleData = {
        slug: context.slug,
        title: context.titleIt,
        excerpt: context.excerptIt,
        content: context.contentIt,
        titleEn: context.titleEn,
        excerptEn: context.excerptEn,
        contentEn: context.contentEn,
        author: context.author || "AI Agent",
        publishAt: new Date().toISOString(),
        images: context.imageUrl ? [context.imageUrl] : [],
        hashtags: context.hashtags
          ? context.hashtags.split(",").map((h: string) => h.trim())
          : [],
      };

      logger?.info("📤 [createArticle] Sending article data to Radiociclismo API");

      const response = await axios.post(
        "https://radiociclismo.com/api/admin/articles",
        articleData,
        {
          headers: {
            "Content-Type": "application/json",
            Cookie: context.sessionCookie,
          },
          timeout: 30000,
        },
      );

      const articleId = response.data?.id || response.data?._id || String(response.data);

      logger?.info(`✅ [createArticle] Article created with ID: ${articleId}`);

      return {
        articleId: String(articleId),
        success: true,
        message: `Article "${context.titleIt}" created successfully`,
      };
    } catch (error: any) {
      const errMsg = error?.response?.data
        ? JSON.stringify(error.response.data)
        : error instanceof Error
          ? error.message
          : String(error);
      logger?.error("❌ [createArticle] Error creating article", { error: errMsg });
      return {
        articleId: "",
        success: false,
        message: `Failed to create article: ${errMsg}`,
      };
    }
  },
});

export const publishArticleTool = createTool({
  id: "publish-article",
  description:
    "Publishes an article on Radiociclismo.com using its ID and the admin session cookie.",
  inputSchema: z.object({
    sessionCookie: z.string().describe("The connect.sid session cookie from login"),
    articleId: z.string().describe("The ID of the article to publish"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info(`📢 [publishArticle] Publishing article ID: ${context.articleId}`);

    try {
      const response = await axios.post(
        `https://radiociclismo.com/api/admin/articles/${context.articleId}/publish`,
        {},
        {
          headers: {
            "Content-Type": "application/json",
            Cookie: context.sessionCookie,
          },
          timeout: 30000,
        },
      );

      logger?.info(
        `✅ [publishArticle] Article ${context.articleId} published successfully`,
      );

      return {
        success: true,
        message: `Article ${context.articleId} published successfully`,
      };
    } catch (error: any) {
      const errMsg = error?.response?.data
        ? JSON.stringify(error.response.data)
        : error instanceof Error
          ? error.message
          : String(error);
      logger?.error("❌ [publishArticle] Error publishing article", {
        error: errMsg,
      });
      return {
        success: false,
        message: `Failed to publish article: ${errMsg}`,
      };
    }
  },
});

async function getSessionCookie(logger?: any): Promise<string> {
  const username = process.env.RC_USERNAME;
  const password = process.env.RC_PASSWORD;

  if (!username || !password) {
    logger?.error("❌ Missing RC_USERNAME or RC_PASSWORD");
    return "";
  }

  const response = await axios.post(
    "https://radiociclismo.com/api/admin/login",
    { username, password },
    {
      headers: { "Content-Type": "application/json" },
      withCredentials: true,
      maxRedirects: 0,
      validateStatus: (s: number) => s < 400,
    },
  );

  const cookies = response.headers["set-cookie"] || [];
  for (const cookie of cookies) {
    if (cookie.includes("connect.sid")) {
      return cookie.split(";")[0];
    }
  }
  if (cookies.length > 0) return cookies[0].split(";")[0];
  return "";
}

export const listArticlesTool = createTool({
  id: "list-articles",
  description:
    "Lists all articles on Radiociclismo.com. Use this to see article IDs, titles, authors, and publication status. Useful before deleting articles.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    success: z.boolean(),
    articles: z.array(z.object({
      id: z.number(),
      title: z.string(),
      slug: z.string(),
      author: z.string(),
      publishAt: z.string(),
    })),
    message: z.string(),
  }),
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("📋 [listArticles] Fetching article list from Radiociclismo...");

    try {
      const sessionCookie = await getSessionCookie(logger);
      if (!sessionCookie) {
        return { success: false, articles: [], message: "Login failed" };
      }

      const response = await axios.get(
        "https://radiociclismo.com/api/admin/articles",
        {
          headers: { Cookie: sessionCookie },
          timeout: 15000,
        },
      );

      const articles = (response.data || []).map((a: any) => ({
        id: a.id,
        title: a.title || "",
        slug: a.slug || "",
        author: a.author || "",
        publishAt: a.publishAt || "",
      }));

      logger?.info(`✅ [listArticles] Found ${articles.length} article(s)`);
      return {
        success: true,
        articles,
        message: `Found ${articles.length} article(s)`,
      };
    } catch (error: any) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger?.error("❌ [listArticles] Error", { error: errMsg });
      return { success: false, articles: [], message: `Error: ${errMsg}` };
    }
  },
});

export const deleteArticleTool = createTool({
  id: "delete-article",
  description:
    "Deletes an article from Radiociclismo.com by its ID. Use list-articles first to find the article ID. This permanently removes the article.",
  inputSchema: z.object({
    articleId: z.string().describe("The ID of the article to delete"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info(`🗑️ [deleteArticle] Deleting article ID: ${context.articleId}`);

    try {
      const sessionCookie = await getSessionCookie(logger);
      if (!sessionCookie) {
        return { success: false, message: "Login failed" };
      }

      const response = await axios.delete(
        `https://radiociclismo.com/api/admin/articles/${context.articleId}`,
        {
          headers: { Cookie: sessionCookie },
          timeout: 30000,
        },
      );

      logger?.info(`✅ [deleteArticle] Article ${context.articleId} deleted successfully`);
      return {
        success: true,
        message: `Article ${context.articleId} deleted successfully`,
      };
    } catch (error: any) {
      const errMsg = error?.response?.data
        ? JSON.stringify(error.response.data)
        : error instanceof Error
          ? error.message
          : String(error);
      logger?.error("❌ [deleteArticle] Error deleting article", { error: errMsg });
      return {
        success: false,
        message: `Failed to delete article ${context.articleId}: ${errMsg}`,
      };
    }
  },
});
