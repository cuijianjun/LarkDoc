<template>
  <!-- 🔴 这层包裹只为 Vue 2 的「单根节点」约束存在：只读遮罩、入口按钮、popover、
       二级 Dialog、toast 必须是**兄弟**（它们全是 `position: fixed`，若挂在彼此内部，
       祖先一旦有 transform 就会改写 fixed 的包含块而漂走）。包裹层自身**不能有
       transform / filter / overflow / 非 static 定位**，见 styles/share.css 同名注释。

       P6b-03 形态纪律（00-README 行 ~119）：分享是 **popover 不是 Dialog** —— 480×331、
       z 99、**无遮罩**、点击外部即关；二级「权限设置」才是 Dialog（z 1000，有遮罩）。
       两者是**两层叠加**：Dialog 打开时 popover 不关。 -->
  <div class="lark-doc-share-layer">
    <!-- canView:false —— 05 §5.3.1 B24 首行：8 项里**唯一**允许不挂载的一项。
         其余 7 项一律「挂载 + 置灰」，这里一条都不隐藏。 -->
    <div
      v-if="ed.shareViewMaskVisible"
      class="lark-doc-share-mask"
      role="alertdialog"
      aria-label="你没有查看权限"
    >
      <div class="lark-doc-share-mask-card">
        <!-- 图标位本库自定（04 未采遮罩内图标），只做 64×64 圆底 + 锁形描边。 -->
        <span
          class="lark-doc-share-mask-icon"
          aria-hidden="true"
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect
              x="4.5"
              y="10.5"
              width="15"
              height="9.5"
              rx="2"
            /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /><path d="M12 14.5v2.5" />
          </svg>
        </span>
        <p class="lark-doc-share-mask-title">
          你没有查看权限
        </p>
        <!-- 04 §4.1.1 ⑥：申请流程**诚实未采**（需双账号）。这里只把点击抛给宿主，不自造审批流。 -->
        <button
          type="button"
          class="lark-doc-share-btn-filled"
          @click="ed.requestShareAccess()"
        >
          申请权限
        </button>
      </div>
    </div>
    <!-- 分享入口由 TopBar / 隐藏标题栏时的 ToolbarBar 渲染；浮层始终与正文兄弟挂载。 -->
    <!-- popover 外壳 480×331 / z 99 / pad 2px 0 0 / 透明底 / radius 0。 -->
    <div
      v-if="ed.sharePopoverOpen"
      class="lark-doc-share-popover"
      role="dialog"
      aria-label="分享文档"
      :style="[ed.sharePopoverStyle(), ed.shareRemote ? { height: 'auto' } : null]"
    >
      <div
        class="lark-doc-share-popover-inner"
        :style="{ ...(ed.shareRemote ? { height: 'auto' } : {}), maxHeight: `calc(100vh - ${ed.sharePopoverPos.top}px - 10px)`, overflowY: 'auto' }"
      >
        <!-- 标题栏 480×45（pad 13px 16px 8px）：左「分享文档」64×22 fs16 var(--ld-share-text)，
             右「权限设置」84×24（图标 20×16）。 -->
        <div class="lark-doc-share-header">
          <h3 class="lark-doc-share-header-title">
            分享文档
          </h3>
          <div class="lark-doc-share-header-actions">
            <button
              type="button"
              class="lark-doc-share-perm-btn"
              aria-label="权限设置"
              @click="ed.openPermissionDialog()"
            >
              <!-- 齿轮图标 20×16（本库自定，04 只量了尺寸没给 SVG）。 -->
              <svg
                width="20"
                height="16"
                viewBox="0 0 20 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <circle
                  cx="10"
                  cy="8"
                  r="3.2"
                /><path d="M10 1.6v2.2M10 12.2v2.2M3.4 4.6l1.9 1.1M14.7 10.3l1.9 1.1M3.4 11.4l1.9-1.1M14.7 5.7l1.9-1.1" />
              </svg>
              <span>权限设置</span>
            </button>
          </div>
        </div>
        <!-- 协作者行 480×54（pad 0 16px）：左文案 70×20 fs14，右头像 26×26 + 溢出块 31×26。 -->
        <div class="lark-doc-share-member-row">
          <span class="lark-doc-share-member-text">已有协作者</span>
          <button
            v-if="ed.shareRemote"
            type="button"
            class="lark-doc-share-member-toggle"
            :aria-expanded="ed.shareMemberListOpen ? 'true' : 'false'"
            @click="ed.toggleShareMembers()"
          >
            {{ ed.shareMembersBusy ? '加载中…' : ed.shareMembers ? ed.shareMembers.members.filter(member => member.scopes.includes('document.read')).length + ' 位协作者' : '查看协作者' }} ›
          </button>
          <div
            v-else
            class="lark-doc-share-avatars"
          >
            <span
              class="lark-doc-share-avatar"
              aria-hidden="true"
            >{{ ed.shareCollaboratorInitial }}</span>
            <span class="lark-doc-share-avatar-more">+2</span>
          </div>
        </div>
        <!-- 邀请输入框：聚焦态是**外壳描边**（448×36 radius6 border 1px var(--ld-share-brand)），
             内部 input 393×26 无边框；右侧组织入口 36×34 靠 border-left 分割。 -->
        <div class="lark-doc-share-invite">
          <input
            :value="ed.shareInviteQuery"
            aria-label="邀请协作者"
            :placeholder="ed.shareRemote ? '搜索用户' : '搜索用户、群组、部门、用户组或智能体'"
            :disabled="ed.shareRemote && !ed.shareCan('canManagePermission')"
            @input="ed.setShareInviteQuery($event.target.value)"
            @keydown.enter.prevent="ed.shareRemote && ed.searchShareDirectory()"
          >
          <button
            type="button"
            class="lark-doc-share-org-entry"
            :aria-label="ed.shareRemote ? '搜索协作者' : '选择组织范围'"
            :disabled="ed.shareRemote && (ed.shareDirectoryBusy || !ed.shareInviteQuery.trim())"
            @click="ed.shareRemote && ed.searchShareDirectory()"
          >
            {{ ed.shareRemote ? '搜索' : '⌄' }}
          </button>
        </div>
        <div
          v-if="ed.shareRemote"
          class="lark-doc-share-remote-members"
        >
          <button v-if="ed.session && ed.session.user && ed.session.getProvider('authorization') && typeof ed.session.getProvider('authorization').documentAccess === 'function'"
            type="button" @click="ed.openDocumentAccessRequests('self')">权限申请</button>
          <p
            v-if="ed.shareMembersError"
            role="status"
          >
            {{ ed.shareMembersError }} <button
              type="button"
              @click="ed.loadShareMembers()"
            >
              重试
            </button>
          </p>
          <p
            v-if="ed.shareDirectoryBusy"
            role="status"
          >
            正在搜索…
          </p>
          <div
            v-if="ed.shareCandidates.length"
            class="lark-doc-share-candidates"
            aria-label="搜索结果"
          >
            <button
              v-for="candidate in ed.shareCandidates"
              :key="candidate.principalId"
              type="button"
              @click="ed.selectShareCandidate(candidate)"
            >
              <span
                class="lark-doc-share-avatar"
                aria-hidden="true"
              >{{ candidate.displayName.slice(-1) }}</span>
              {{ candidate.displayName }} <small>{{ candidate.principalId }}</small>
            </button>
          </div>
          <div
            v-if="ed.shareSelectedCandidate"
            class="lark-doc-share-invite-actions"
          >
            <span>{{ ed.shareSelectedCandidate.displayName }}</span>
            <select
              :value="ed.shareInviteRole"
              aria-label="邀请权限"
              @change="ed.setShareInviteRole($event.target.value)"
            >
              <option value="reader">
                可阅读
              </option><option value="commenter">
                可评论
              </option><option value="editor">
                可编辑
              </option>
            </select>
            <button
              type="button"
              class="lark-doc-share-btn-filled"
              :disabled="ed.shareRemoteBusy || !!ed.sharePendingOperation || !ed.shareMembers"
              @click="ed.changeShareMember(ed.shareSelectedCandidate.principalId, ed.shareInviteRole)"
            >
              邀请
            </button>
          </div>
          <div
            v-if="ed.shareMemberListOpen && ed.shareMembers"
            class="lark-doc-share-member-list"
            aria-label="协作者列表"
          >
            <div
              v-for="member in ed.shareMembers.members.filter(value => value.scopes.includes('document.read'))"
              :key="member.principalId"
              class="lark-doc-share-member-item"
            >
              <span
                class="lark-doc-share-avatar"
                aria-hidden="true"
              >{{ member.principalId.slice(0, 1).toUpperCase() }}</span>
              <span class="lark-doc-share-member-name">{{ member.principalId }}<small v-if="!ed.shareMemberSource(member) || ed.shareMemberSource(member).revoked">其他来源授权</small></span>
              <span v-if="member.scopes.includes('grant.manage')">可管理</span>
              <template v-else-if="ed.shareMemberSource(member) && !ed.shareMemberSource(member).revoked">
                <select
                  :value="ed.shareMemberRole(member)"
                  :aria-label="member.principalId + ' 的分享权限'"
                  :disabled="ed.shareRemoteBusy || !!ed.sharePendingOperation"
                  @change="ed.changeShareMember(member.principalId, $event.target.value)"
                >
                  <option value="reader">
                    可阅读
                  </option><option value="commenter">
                    可评论
                  </option><option value="editor">
                    可编辑
                  </option>
                </select>
                <button
                  type="button"
                  :aria-label="'移除 ' + member.principalId + ' 的分享授权'"
                  :disabled="ed.shareRemoteBusy || !!ed.sharePendingOperation"
                  @click="ed.changeShareMember(member.principalId, ed.shareMemberRole(member), true)"
                >
                  移除
                </button>
              </template>
              <span v-else>{{ ed.shareMemberRole(member) === 'editor' ? '可编辑' : ed.shareMemberRole(member) === 'commenter' ? '可评论' : '可阅读' }}</span>
            </div>
            <p class="lark-doc-share-source-note">
              移除分享授权后，其他来源的权限仍可能有效。
            </p>
          </div>
        </div>
        <p
          v-if="ed.shareRemoteState"
          role="status"
        >
          {{ ed.shareRemoteState.status === 'committed' ? '协作者权限已更新。' : '权限信息未能确认，请联系管理员。' }}
        </p>
        <button
          v-if="ed.sharePendingOperation"
          type="button"
          :disabled="ed.shareRemoteBusy || !ed.shareCan('canManagePermission')"
          @click="ed.queryPendingShare()"
        >
          查询原分享操作
        </button>
        <!-- 下半区 480×194（pad 12px 0 0）。 -->
        <div class="lark-doc-share-lower">
          <!-- 链接分享卡 480×116（pad 16）。 -->
          <div class="lark-doc-share-link-card">
            <div class="lark-doc-share-link-head">
              <span class="lark-doc-share-link-title">链接分享</span>
              <!-- 权限标签 bg rgba(20,86,240,0.2) / color var(--ld-share-brand) / fs10（内容 span 12px）/ radius 4。
                   文案取下拉同值的「可编辑」：③ 只认证了下拉取值与 scope 文案，标签文本未采。 -->
              <span class="lark-doc-share-link-tag"><span>{{ ed.shareLinkPermLabel }}</span></span>
            </div>
            <div class="lark-doc-share-link-body">
              <!-- 圆形图标 30×30 / bg var(--ld-share-avatar-bg) / radius 50%。 -->
              <span class="lark-doc-share-link-icon">
                <lark-doc-icon
                  name="link"
                  :size="14"
                />
              </span>
              <div class="lark-doc-share-link-main">
                <span
                  v-if="ed.shareRemote"
                  class="lark-doc-share-org-label"
                >{{ ed.shareLinkState && ed.shareLinkState.audience === 'public' ? '互联网上获得链接的人' : '当前文档协作者' }}</span>
                <button
                  v-else
                  type="button"
                  class="lark-doc-share-org-btn"
                >
                  {{ ed.shareOrgName }}
                </button>
                <!-- 权限说明 var(--ld-share-text-secondary) / fs 12。文案由 mixin 拼装（一级口径：跟着上面那个下拉变）。 -->
                <span class="lark-doc-share-scope-text">{{ ed.shareScopeText }}</span>
              </div>
              <select
                class="lark-doc-share-perm-select"
                aria-label="链接权限"
                :value="ed.shareLinkPermLabel"
                :disabled="ed.shareRemote && (ed.shareLinkBusy || !!ed.shareLinkPending || !ed.shareLinkState || !ed.shareLinkState.cryptoReady)"
                @change="ed.setShareLinkPerm($event.target.value)"
              >
                <option
                  v-for="option in ed.shareLinkPermOptions"
                  :key="option"
                  :value="option"
                >
                  {{ option }}
                </option>
              </select>
            </div>
            <div class="lark-doc-share-copy-row">
              <button
                type="button"
                class="lark-doc-share-btn-filled"
                :disabled="ed.shareRemote && ed.shareCan('canManagePermission') && (ed.shareLinkBusy || !!ed.shareLinkPending || !ed.shareLinkState)"
                @click="ed.copyShareLink()"
              >
                复制链接
              </button>
              <button v-if="ed.shareRemote && ed.shareLinkPending" type="button" :disabled="ed.shareLinkBusy" @click="ed.remoteLinkAction('load')">核对原操作</button>
            </div>
            <p v-if="ed.shareRemote && ed.shareLinkError" role="status">{{ ed.shareLinkError }}</p>
          </div>
        </div>
      </div>
    </div>
    <!-- 二级权限 Dialog（z 1000 / 有遮罩）。打开时 popover **不关**（04 §4.1.1 ① 两层叠加）。 -->
    <permission-dialog
      v-if="ed.permissionDialogOpen"
      :ed="ed"
    />
    <!-- 两型 toast：成功/复制绿（⑤-4）、校验失败橙（⑤-9），约 3s 自动消失。 -->
    <div
      v-if="ed.shareToast"
      class="lark-doc-share-toast"
      :class="`is-${ed.shareToast.kind}`"
      role="status"
    >
      <span class="lark-doc-share-toast-text">{{ ed.shareToast.text }}</span>
    </div>
  </div>
</template>

<script>
/**
 * 分享 popover（P6b-03）—— 顶栏入口 + 一级分享面板 + 只读遮罩入口。
 *
 * 规格：requirements/04 §4.1（结构清单 ④ + 像素 ④-2 batch60/61）、00-README 行 ~119。
 *
 * 三条负结论（别实现）：
 *   1. **这不是 Dialog**：没有遮罩、没有 `--dismiss-on-mask`，z 只有 99。加遮罩会让形态变错。
 *   2. **这里的「复制链接」不带密码**。带密码的复制在二级权限 Dialog 的加密链接块里
 *      （04 §4.1.1 ⑤-4），一级面板没有密码入口。
 *   3. **成员列表 / 组织范围不做真实 CRUD**。04 §4.1 ② 只采到「+2 头像聚合」与一个邀请
 *      输入框；组织列表属于宿主数据，本库只留 `shareOrgName` 一个字符串位。
 */
import LarkDocIcon from './LarkDocIcon.vue'
import PermissionDialog from './PermissionDialog.vue'

export default {
  name: 'LarkDocSharePopover',
  components: { LarkDocIcon, PermissionDialog },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>


<style>
/* 面板主题色与本组件同步加载，保证首次暗色渲染。 */
.lark-doc[data-theme-preset="feishu"][data-theme="dark"] {
  --ld-share-surface: var(--ld-bg-surface);
  --ld-share-text: var(--ld-text);
  --ld-share-text-strong: var(--ld-text);
  --ld-share-text-secondary: var(--ld-text-secondary);
  --ld-share-text-tertiary: var(--ld-text-tertiary);
  --ld-share-text-disabled: var(--ld-text-disabled);
  --ld-share-border: var(--ld-border);
  --ld-share-border-control: var(--ld-border-control);
  --ld-share-bg-subtle: var(--ld-bg-code);
  --ld-share-toast-success-bg: var(--ld-bg-badge);
}
</style>
