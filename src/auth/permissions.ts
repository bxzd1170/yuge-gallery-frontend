/**
 * 权限模型 —— 集中一处，所有页面共用。
 *
 * 为什么要有这个文件：
 *   权限判断本来散落在各个页面里（`userRole === 'admin'` 到处写），
 *   改一处漏一处，而且很容易"凭感觉"发明后端并不支持的规则。
 *   这里把每条规则**连同它的后端依据**写在一起，页面只调用函数、不自己判断。
 *
 * 数据来源：
 *   · 角色：登录态 `userRole`（admin / user），后端 `UserConstant.ADMIN_ROLE`
 *   · 空间角色：`spaceUser` 表里的 spaceRole（viewer / editor / admin）
 *   · 空间归属：`space.userId` 是否等于当前用户
 *
 * ⚠️ 前端这些判断只用于「决定给不给你看 / 能不能点」，
 *    真正的鉴权在后端（Sa-Token 注解 + AOP）。前端判错最多是体验问题，
 *    后端判错才是安全问题 —— 所以绝不能反过来依赖前端。
 */

export interface CurrentUser {
  id?: string | number
  userRole?: string
}

export interface SpaceLike {
  id?: string | number
  userId?: string | number
  /** 0 私有 / 1 团队 */
  spaceType?: number
}

export type SpaceRole = 'viewer' | 'editor' | 'admin' | string

/* ------------------------------------------------------------------ *
 * 基础
 * ------------------------------------------------------------------ */

/** 系统管理员：`userRole === 'admin'` */
export function isAdmin(user?: CurrentUser | null): boolean {
  return user?.userRole === 'admin'
}

/** 是否本人（雪花 ID 在 JSON 里是字符串，一律用 String 比较） */
export function isSelf(user?: CurrentUser | null, targetUserId?: string | number): boolean {
  const mine = user?.id
  if (mine == null || mine === '' || targetUserId == null || targetUserId === '') return false
  return String(mine) === String(targetUserId)
}

/* ------------------------------------------------------------------ *
 * 图片
 * ------------------------------------------------------------------ */

/**
 * 编辑图片信息。
 * 后端：`@SaSpaceCheckPermission(PICTURE_EDIT)`，权限由 `StpInterfaceImpl` 算出，共三种情况：
 *   · 公共图库（spaceId 为空）→ 图片所属人本人或系统管理员
 *   · 私有空间 → 空间创建者本人或系统管理员
 *   · **团队空间 → 查 `space_user`：editor / admin 都能编辑「别人上传到该空间」的图**
 *
 * 第三条就是「共同编辑」，也是最容易漏的一条：
 * 只按 `userId === 我` 判断的话，团队空间的编辑者在界面上会变成什么都点不了 ——
 * 后端明明给了 `picture:edit`，前端却把按钮藏了。
 *
 * @param spacePerms `/space/get/vo` 返回的 `permissionList`（后端算好的权威结论）。
 *   图片属于某个空间时传它，前端就不再自己推算角色；传了就以它为准（空数组 = 无权限）。
 */
export function canEditPicture(
  user: CurrentUser | null | undefined,
  pictureOwnerId?: string | number,
  spacePerms?: string[] | null,
): boolean {
  if (spacePerms) return spacePerms.includes('picture:edit')
  return isAdmin(user) || isSelf(user, pictureOwnerId)
}

/** 删除图片。同编辑，权限码是 `PICTURE_DELETE`（团队空间的 editor 也有）。 */
export function canDeletePicture(
  user: CurrentUser | null | undefined,
  pictureOwnerId?: string | number,
  spacePerms?: string[] | null,
): boolean {
  if (spacePerms) return spacePerms.includes('picture:delete')
  return isAdmin(user) || isSelf(user, pictureOwnerId)
}

/**
 * 能否看到「成员管理」以外的空间协作入口（上传 / 编辑）—— 直接用后端 permissionList。
 * 之所以单独写一个：上传页曾自己实现过一套 role 判断，容易和后端配置漂移。
 */
export function hasSpacePermission(spacePerms: string[] | null | undefined, code: string): boolean {
  return Boolean(spacePerms?.includes(code))
}

/** 批量抓取上传。后端 `/picture/upload/batch` 标了 `@AuthCheck(mustRole = ADMIN_ROLE)`。 */
export const canBatchUpload = isAdmin

/** 审核图片（通过/拒绝）。后端 `/picture/review` 仅管理员。 */
export const canReviewPicture = isAdmin

/**
 * 查看审核状态。
 * 只有管理端的 `/picture/list/page` 返回原始 `Picture`（含 reviewStatus），
 * 用户侧的 `PictureVO` **不含**该字段 —— 所以普通用户界面上根本看不到审核状态。
 */
export const canSeeReviewStatus = isAdmin

/* ------------------------------------------------------------------ *
 * 空间
 * ------------------------------------------------------------------ */

/**
 * 能否使用某个空间等级。
 * 后端 `SpaceServiceImpl#addSpace`：非管理员只能创建普通版（COMMON = 0），
 * 其他等级直接抛「无权限创建指定级别的空间」。
 */
export const canUseSpaceLevel = (user: CurrentUser | null | undefined, level: number) =>
  isAdmin(user) || level === 0

/**
 * 能否改空间的等级与配额。
 * 后端 `/space/update` 仅管理员；用户侧的 `SpaceEditRequest` 只有 id + spaceName（只能改名）。
 */
export const canEditSpaceQuota = isAdmin

/**
 * 能否分析某个空间。
 * 后端 `SpaceAnalyzeServiceImpl#checkSpaceAnalyzeAuth` → 指定空间时走
 * `spaceService.checkSpaceAuth`，即**仅空间创建者本人或系统管理员** —— **空间成员也不行**。
 * （这一点和图片接口不同，图片接口里成员是有权限的。）
 */
export const canAnalyzeSpace = (user: CurrentUser | null | undefined, space?: SpaceLike | null) =>
  isAdmin(user) || isSelf(user, space?.userId)

/** 能否分析公共图库 / 全空间。后端仅管理员（`queryPublic` / `queryAll` 分支）。 */
export const canAnalyzeGlobal = isAdmin

/**
 * 能否按颜色搜索。
 * 后端 `SpaceServiceImpl#searchPictureByColor` 里是
 * `if (!space.getUserId().equals(loginUser.getId())) 抛「没有空间访问权限」`
 * —— **只认空间创建者本人**，成员和系统管理员都不算。
 */
export const canSearchByColor = (user: CurrentUser | null | undefined, space?: SpaceLike | null) =>
  isSelf(user, space?.userId)

/**
 * 能否管理空间成员（增删改）。
 * 后端：`@SaSpaceCheckPermission(spaceUser:manage)`，权限由 `StpInterfaceImpl` 按空间类型算：
 *   · 私有空间 → 本人或系统管理员拿到 ADMIN 权限（含 spaceUser:manage）
 *   · 团队空间 → 查 `space_user` 表，取我在该空间的角色；
 *     不是成员就**没有任何权限**（连系统管理员也一样，除非他是成员）
 * 团队空间创建时后端会自动把创建者写入 `space_user` 且角色为 admin。
 */
export function canManageSpaceMembers(
  user: CurrentUser | null | undefined,
  space?: SpaceLike | null,
  myRoleInSpace?: SpaceRole | null,
): boolean {
  if (!space) return false
  const isTeam = space.spaceType === 1
  if (!isTeam) {
    // 私有空间：本人或系统管理员
    return isAdmin(user) || isSelf(user, space.userId)
  }
  // 团队空间：只看我在 space_user 里的角色
  return myRoleInSpace === 'admin'
}

/** 能否往某个空间上传图片。空间成员按角色给权限（viewer 不能上传）。 */
export function canUploadToSpace(
  user: CurrentUser | null | undefined,
  space?: SpaceLike | null,
  myRoleInSpace?: SpaceRole | null,
): boolean {
  if (!space) return false // 没选空间 = 公共图库，任何登录用户都能传
  const isTeam = space.spaceType === 1
  if (!isTeam) return isAdmin(user) || isSelf(user, space.userId)
  return myRoleInSpace === 'editor' || myRoleInSpace === 'admin'
}

/* ------------------------------------------------------------------ *
 * 用户
 * ------------------------------------------------------------------ */

/** 用户列表 / 改角色 / 删用户。后端 `/user/list/page/vo`、`/user/update`、`/user/delete` 全部仅管理员。 */
export const canManageUsers = isAdmin

/**
 * 能否自助修改自己的资料。
 * 后端 `/user/update` 已改为「本人可改自己（不含角色）｜管理员可改任意人」，
 * 所以只要登录就能编辑自己的资料，不再依赖管理员身份。
 */
export const canEditOwnProfile = (user?: API.LoginUserVO) => Boolean(user?.id)

/* ------------------------------------------------------------------ *
 * 路由级
 * ------------------------------------------------------------------ */

/** 需要管理员才能进入的路由（与 router 里的 `meta.requiresAdmin` 对应） */
export const ADMIN_ONLY_ROUTE_NAMES = ['adminUsers', 'adminPictures', 'adminSpaces'] as const

/** 判断能否进入某个路由 */
export function canAccessRoute(
  user: CurrentUser | null | undefined,
  meta: { requiresAdmin?: boolean },
): boolean {
  return meta.requiresAdmin ? isAdmin(user) : true
}
