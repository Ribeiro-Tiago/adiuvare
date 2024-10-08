import { and, count, desc, eq, sql, or, arrayOverlaps, SQLWrapper, SQL } from "drizzle-orm";

import { db } from "./";
import { POST_NEEDS, posts } from "./schemas/posts.schema";
import { users } from "./schemas/users.schema";
import { postHistory } from "./schemas/postHistory.schema";
import { FEED_PAGE_SIZE } from "@/utils";

import type { InsertPost } from "./schemas/posts.schema";
import type { PostFilter, UpdatePostPayload } from "@/types/post";

type Query = SQLWrapper[] | SQL<any>[] | undefined;

const getFreeInputQuery = (query: string): Query => {
  query = query.toLowerCase();
  const fuzzy = `%${query}%`;

  const conditions: Query = [
    sql`unaccent(lower(${posts.description})) like unaccent(${fuzzy})`,
    sql`unaccent(lower(${posts.title})) like unaccent(${fuzzy})`,
    sql`unaccent(lower(${users.name})) like unaccent(${fuzzy})`,
    sql`unaccent(lower(${users.bio})) like unaccent(${fuzzy})`,
    arrayOverlaps(posts.locations, [query]),
  ];

  if (Object.values(POST_NEEDS).includes(query)) {
    conditions.push(arrayOverlaps(posts.needs, [query]));
  }

  return [or(...conditions) as SQL<any>];
};

const getDetailedFilter = (filter: PostFilter): Query => {
  const toFuzzy = (str: string) => `%${str}%`;

  const conditions: SQLWrapper[] = [];

  if (filter.title) {
    conditions.push(sql`unaccent(lower(${posts.title})) like unaccent(${toFuzzy(filter.title)})`);
  }

  if (filter.description) {
    conditions.push(
      sql`unaccent(lower(${posts.description})) like unaccent(${toFuzzy(filter.description)})`,
    );
  }

  if (filter.locations?.length) {
    conditions.push(arrayOverlaps(posts.locations, filter.locations));
  }

  if (filter.needs?.length) {
    conditions.push(arrayOverlaps(posts.needs, filter.needs));
  }

  // unexpected filtering
  if (!conditions.length) {
    useBugsnag().notify({
      name: "[posts] unexpected filtering in get posts",
      message: JSON.stringify(conditions),
    });

    return undefined;
  }

  return conditions;
};

export const getPostsAndTotal = async (filter?: PostFilter) => {
  let query: Query = undefined;

  if (filter) {
    query = filter.query ? getFreeInputQuery(filter.query) : getDetailedFilter(filter);
  }

  const [result, total] = await Promise.all([getPosts(query), getTotalPosts(query)]);

  return { posts: result, total };
};

export const getPosts = async (conditions?: Query) => {
  const query = conditions
    ? and(eq(posts.state, "active"), ...conditions)
    : eq(posts.state, "active");

  const result = await db
    .select({
      id: posts.id,
      title: posts.title,
      description: posts.description,
      locations: posts.locations,
      needs: posts.needs,
      schedule: posts.schedule,
      createdAt: posts.createdAt,
      slug: posts.slug,
      contacts: posts.contacts,
      createdBy: users.slug,
      createdBySlug: users.slug,
    })
    .from(posts)
    .innerJoin(users, eq(posts.createdUserId, users.id))
    .where(query)
    .orderBy(desc(posts.createdAt))
    .limit(FEED_PAGE_SIZE);

  return result || [];
};

export const getTotalPosts = async (conditions?: Query) => {
  try {
    let result;

    // if filter exists we need to inner join with users because
    // filter can be looking for user prop
    if (conditions) {
      result = await db
        .select({ total: count() })
        .from(posts)
        .innerJoin(users, eq(posts.createdUserId, users.id))
        .where(and(eq(posts.state, "active"), ...conditions));
    } else {
      // if filter doesn't exist, we can just query all posts
      result = await db.select({ total: count() }).from(posts).where(eq(posts.state, "active"));
    }

    return result[0].total ?? 0;
  } catch (_) {
    return 0;
  }
};

export const createPost = async (payload: InsertPost) => {
  const result = await db.insert(posts).values(payload).returning({
    id: posts.id,
    title: posts.title,
    state: posts.state,
    description: posts.description,
    contacts: posts.contacts,
    needs: posts.needs,
    locations: posts.locations,
    schedule: posts.schedule,
    slug: posts.slug,
    createdAt: posts.createdAt,
    updatedAt: posts.updatedAt,
  });

  return result[0];
};

export const updatePost = async (slug: string, payload: UpdatePostPayload, userId: string) => {
  const old = await getPostBySlug(slug, true);

  if (!old) {
    return null;
  }

  if (old.createdById !== userId) {
    return { ...old, updated: old };
  }

  await db.transaction(async (tx) => {
    // update post
    try {
      await tx
        .update(posts)
        .set({ ...payload, updatedBy: userId, updatedAt: new Date() })
        .where(eq(posts.slug, slug));

      // add entry to history
      await tx.insert(postHistory).values({
        postId: old.id,
        userId: userId,
        updatedAt: new Date(),
        state: old.state,
        description: old.description,
        locations: old.locations,
        schedule: old.schedule,
        needs: old.needs,
        title: old.title,
        slug: old.slug,
        contacts: old.contacts,
      });
    } catch (err) {
      tx.rollback();
    }
  });

  return { ...old, ...payload };
};

export const deletePost = async (id: string) => {
  return await db.delete(posts).where(eq(posts.id, id));
};

export const getPost = async (postId: string) => {
  const result = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);

  return result.length === 1 ? result[0] : null;
};

export const getPostByOwner = async (postId: string, userId: string) => {
  const result = await db
    .select({ createdBy: users.name })
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.createdUserId, userId)))
    .limit(1);

  return result.length === 1 ? result[0] : null;
};

export const getPostBySlug = async (slug: string, getId = false) => {
  const result = await db
    .select({
      id: posts.id,
      title: posts.title,
      description: posts.description,
      locations: posts.locations,
      needs: posts.needs,
      schedule: posts.schedule,
      createdAt: posts.createdAt,
      updatedAt: posts.updatedAt,
      state: posts.state,
      slug: posts.slug,
      contacts: posts.contacts,
      createdBy: users.slug,
      ...(getId && { createdById: posts.createdUserId }),
    })
    .from(posts)
    .where(and(eq(posts.slug, slug)))
    .innerJoin(users, eq(posts.createdUserId, users.id))
    .limit(1);

  return result.length === 1 ? result[0] : null;
};
