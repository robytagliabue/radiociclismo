import { createTool } from "@mastra/core";
import { z } from "zod";
import axios from "axios";

// Funzione helper per il cookie di sessione (usata internamente dai tool)
async function getSessionCookie(): Promise<string> {
  const username = process.env.RC_USERNAME;
  const password = process.env.RC_PASSWORD;

  if (!username || !password) return "";

  try {
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
    return cookies.length > 0 ? cookies[0].split(";")[0] : "";
  } catch (e) {
    return "";
  }
}

export const loginRadiociclismoTool = createTool({
  id: "login-radiociclismo",
  description: "Logs into the Radiociclismo admin panel.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    sessionCookie: z.string(),
    success: z.boolean(),
  }),
  execute: async () => {
    const sessionCookie = await getSessionCookie();
    return { sessionCookie, success: !!sessionCookie };
  },
});

export const createArticleTool = createTool({
  id: "create-article",
  description: "Creates a new article on Radiociclismo.com.",
  inputSchema: z.object({
    sessionCookie: z.string(),
    slug: z.string(),
    titleIt: z.string(),
    excerptIt: z.string(),
    contentIt: z.string(),
    titleEn: z.string(),
    excerptEn: z.string(),
    contentEn: z.string(),
    imageUrl: z.string(),
    author: z.string(),
    hashtags: z.string(),
  }),
  execute: async ({ input }) => {
    try {
      const articleData = {
        slug: input.slug,
        title: input.titleIt,
        excerpt: input.excerptIt,
        content: input.contentIt,
        titleEn: input.titleEn,
        excerptEn: input.excerptEn,
        contentEn: input.contentEn,
        author: input.author || "AI Agent",
        publishAt: new Date().toISOString(),
        images: input.imageUrl ? [input.imageUrl] : [],
        hashtags: input.hashtags ? input.hashtags.split(",").map((h) => h.trim()) : [],
      };

      const response = await axios.post(
        "https://radiociclismo.com/api/admin/articles",
        articleData,
        {
          headers: {
            "Content-Type": "application/json",
            Cookie: input.sessionCookie,
          },
        },
      );

      return {
        articleId: String(response.data?.id || ""),
        success: true,
        message: "Article created successfully",
      };
    } catch (error: any) {
      return { articleId: "", success: false, message: "Error creating article" };
    }
  },
});

export const listArticlesTool = createTool({
  id: "list-articles",
  description: "Lists all articles on Radiociclismo.com.",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const sessionCookie = await getSessionCookie();
      const response = await axios.get("https://radiociclismo.com/api/admin/articles", {
        headers: { Cookie: sessionCookie },
      });

      const articles = (response.data || []).map((a: any) => ({
        id: a.id,
        title: a.title || "",
        slug: a.slug || "",
      }));

      return { success: true, articles };
    } catch (error) {
      return { success: false, articles: [] };
    }
  },
});

export const deleteArticleTool = createTool({
  id: "delete-article",
  description: "Deletes an article by ID.",
  inputSchema: z.object({
    articleId: z.string(),
  }),
  execute: async ({ input }) => {
    try {
      const sessionCookie = await getSessionCookie();
      await axios.delete(`https://radiociclismo.com/api/admin/articles/${input.articleId}`, {
        headers: { Cookie: sessionCookie },
      });
      return { success: true, message: "Deleted" };
    } catch (error) {
      return { success: false, message: "Failed" };
    }
  },
});
