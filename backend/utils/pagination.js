const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
// Response shape stays a bare array unless the caller opts in via page/limit — several
// frontend pages still consume these endpoints as plain arrays (see README's Performance
// & Scalability notes), so switching the default shape would break them silently.
const UNPAGINATED_CAP = 1000;

// Reads page/limit off req.query and returns either the current bare-array Prisma args
// (default, capped) or paged args plus a flag so the caller knows which response shape to send.
export const parsePagination = (query = {}) => {
  const paginated = query.page !== undefined || query.limit !== undefined;
  if (!paginated) {
    return { paginated, prismaArgs: { take: UNPAGINATED_CAP } };
  }

  const rawPage = parseInt(query.page, 10);
  const rawLimit = parseInt(query.limit, 10);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize = Math.min(
    Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE
  );

  return { paginated, page, pageSize, prismaArgs: { skip: (page - 1) * pageSize, take: pageSize } };
};
