<template>
  <!-- 二级权限设置 Dialog（P6b-03）。
       🔴 这是 **Dialog 不是 popover**：有全屏遮罩（z 1000）、内容 500×830 @(506,60)、
       半径 8、shadow none（§4.1.1 ②）。它**盖在一级分享 popover 之上且不关它**
       （① 两层叠加），所以这里不调 `closeSharePopover`。

       三种(password / confirm) 子弹窗都在本根节点下，与 popover 的遮罩互不干涉：
       「提示」500×262 @(506,344)、「修改密码」420×312 @(546,319)，二者 z 1001。 -->
  <div class="lark-doc-permission-layer">
    <div
      class="lark-doc-permission-mask"
      @click="closeAll"
    />
    <div
      class="lark-doc-permission-dialog"
      role="dialog"
      aria-label="权限设置"
    >
      <!-- 头部 500×72：面包屑「分享文档」（82×22 fs14）+ 标题「权限设置」（420×24 fs16）+ 关闭 ✕（28×28）。 -->
      <div class="lark-doc-permission-header">
        <div class="lark-doc-permission-crumb">
          分享文档
        </div>
        <div class="lark-doc-permission-head-row">
          <h3 class="lark-doc-permission-title">
            权限设置
          </h3>
          <button
            type="button"
            class="lark-doc-share-close"
            aria-label="关闭"
            @click="closeAll"
          >
            ✕
          </button>
        </div>
      </div>
      <!-- 主体 500×734，`overflow-y: auto`（实测 scrollHeight 925 ⇒ 底部 ~192px 需滚动）。
           🔴 **没有 footer**：权限 Dialog 改完即关、无「保存」（② 末行实测 null）。 -->
      <div class="lark-doc-permission-body">
        <div class="lark-doc-permission-column">
          <p
            v-if="ed.shareRemote && (remoteLoading || remoteError || pendingOperation)"
            role="status"
          >
            {{ remoteLoading ? '正在载入权限设置…' : remoteError || '更改结果待确认，请核对原操作。' }}
            <button
              v-if="pendingOperation"
              type="button"
              :disabled="remoteBusy || remoteLoading || !ed.shareCan('canManagePermission')"
              @click="loadRemotePermissions"
            >
              核对原操作
            </button>
            <button
              v-else-if="remoteError"
              type="button"
              :disabled="remoteBusy || remoteLoading || !ed.shareCan('canManagePermission')"
              @click="loadRemotePermissions"
            >
              重新载入
            </button>
          </p>
          <!-- 邀请协作者入口行 394×20（③ y116）。 -->
          <div class="lark-doc-permission-invite-row">
            <button
              v-if="ed.shareRemote"
              type="button"
              :disabled="!ed.shareCan('canManagePermission')"
              @click="openCollaborators"
            >
              邀请协作者
            </button>
            <span v-else>邀请协作者</span>
          </div>

          <template v-if="!ed.shareRemote">
            <!-- 对外分享 分组标题 437×22（③ y153）。 -->
            <div class="lark-doc-permission-group-title">
              对外分享
            </div>

            <!-- 组织外成员搜索框 384×26（③ y158），placeholder 逐字照抄。 -->
            <div class="lark-doc-permission-search">
              <input
                :value="ed.shareInviteQuery"
                aria-label="搜索用户、群组、部门、用户组或智能体"
                placeholder="搜索用户、群组、部门、用户组或智能体"
                @input="ed.setShareInviteQuery($event.target.value)"
              >
            </div>

            <!-- 允许内容被分享到组织外（③ y183）+ 次级说明（③ y213）。 -->
            <div class="lark-doc-permission-item">
              <div class="lark-doc-permission-row">
                <span class="lark-doc-permission-item-title">允许内容被分享到组织外</span>
                <button
                  type="button"
                  class="lark-doc-permission-switch"
                  :class="{ 'is-on': ed.permissionValues.shareOutsideOrg }"
                  role="switch"
                  :aria-checked="ed.permissionValues.shareOutsideOrg ? 'true' : 'false'"
                  aria-label="允许内容被分享到组织外"
                  @click="toggleValue('shareOutsideOrg')"
                />
              </div>
            </div>
            <div class="lark-doc-permission-desc">
              仅"可管理权限"可以将内容分享到组织外
            </div>

            <!-- 启用加密链接（③ y243）。未勾选 437×22，勾选后 437×78（⑤-1 步 4）。 -->
            <div class="lark-doc-secure-link">
              <div class="lark-doc-secure-link-operation">
                <input
                  class="lark-doc-secure-link-checkbox"
                  type="checkbox"
                  aria-label="启用加密链接"
                  :checked="ed.secureLinkEnabled"
                  @change="ed.toggleSecureLink()"
                >
                <!-- 文案本身 `cursor: pointer`：点字等于点勾选框（⑤-3，`_checkbox-desc`）。 -->
                <span
                  class="lark-doc-secure-link-desc"
                  @click="ed.toggleSecureLink()"
                >启用加密链接</span>
              </div>
              <!-- 密码区只在勾选后「原地长出」；取消确认时整块不渲染。 -->
              <template v-if="ed.secureLinkEnabled">
                <div class="lark-doc-secure-link-password-area">
                  <div class="lark-doc-secure-link-password-row">
                    <span class="lark-doc-secure-link-password-label">密码：</span>
                    <!-- 点密码值本体 **也会复制**（⑤-4：两个入口行为完全等价）。 -->
                    <span
                      class="lark-doc-secure-link-password-val"
                      role="button"
                      @click="ed.copyLinkAndPassword()"
                    >{{ ed.secureLinkPassword }}</span>
                    <button
                      type="button"
                      class="lark-doc-secure-link-edit"
                      aria-label="修改密码"
                      @click="ed.openPasswordDialog()"
                    >
                      <!-- 铅笔 16×16（04 只量了尺寸没给 SVG，这里自绘）。 -->
                      <svg
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.3"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M10.4 2.6l3 3L5.9 13.1l-3.4.5.5-3.4 7.4-7.6z" /><path d="M9.2 3.8l3 3" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="lark-doc-secure-link-copy-btn"
                      @click="ed.copyLinkAndPassword()"
                    >
                      复制链接和密码
                    </button>
                  </div>
                </div>
                <p class="lark-doc-secure-link-tip">
                  {{ SECURE_LINK_TIP }}
                </p>
              </template>
            </div>

            <!-- 「链接分享」详情块（③ y256/y283）：组织名 + scope 文案。
                 它属于 ③ 的行级像素但**不在** ④ 的配置项全集里，位置卡在加密链接与协作者之间。 -->
            <div class="lark-doc-permission-link-detail">
              <button
                type="button"
                class="lark-doc-permission-org-btn"
              >
                {{ ed.shareOrgName }}
              </button>
              <span class="lark-doc-permission-scope-text">{{ ed.shareDialogScopeText }}</span>
            </div>
          </template>
          <div
            v-else
            class="lark-doc-permission-item"
          >
            <div class="lark-doc-permission-group-title">对外分享</div>
            <p v-if="ed.shareLinkError || ed.shareLinkBusy" role="status">{{ ed.shareLinkBusy ? '正在读取或更新链接设置…' : ed.shareLinkError }}</p>
            <button v-if="ed.shareLinkPending || !ed.shareLinkState" type="button" :disabled="ed.shareLinkBusy" @click="ed.remoteLinkAction('load')">{{ ed.shareLinkPending ? '核对原操作' : '重新载入' }}</button>
            <div class="lark-doc-permission-row">
              <span class="lark-doc-permission-item-title">链接分享范围</span>
              <select aria-label="链接分享范围" :value="ed.shareLinkState && ed.shareLinkState.audience" :disabled="ed.shareLinkBusy || !!ed.shareLinkPending || !ed.shareLinkState || !ed.shareLinkState.cryptoReady" @change="ed.remoteLinkAction('audience', $event.target.value)">
                <option value="collaborators">仅已有协作者</option><option value="public">互联网上获得链接的人</option>
              </select>
            </div>
            <div class="lark-doc-secure-link">
              <div class="lark-doc-secure-link-operation">
                <input class="lark-doc-secure-link-checkbox" type="checkbox" aria-label="启用加密链接" :checked="ed.secureLinkEnabled" :disabled="ed.shareLinkBusy || !!ed.shareLinkPending || !ed.shareLinkState || !ed.shareLinkState.cryptoReady" @change="ed.toggleSecureLink()">
                <span class="lark-doc-secure-link-desc" @click="ed.toggleSecureLink()">启用加密链接</span>
              </div>
              <template v-if="ed.secureLinkEnabled">
                <div class="lark-doc-secure-link-password-area">
                  <div class="lark-doc-secure-link-password-row">
                    <span class="lark-doc-secure-link-password-label">密码：</span>
                    <span class="lark-doc-secure-link-password-val" role="button" @click="ed.copyLinkAndPassword()">{{ ed.shareLinkState && ed.shareLinkState.passwordAvailable ? ed.secureLinkPassword : '密码服务未配置' }}</span>
                    <button type="button" class="lark-doc-secure-link-edit" aria-label="修改密码" :disabled="ed.shareLinkBusy || !!ed.shareLinkPending || !ed.shareLinkState || !ed.shareLinkState.cryptoReady" @click="ed.openPasswordDialog()">修改</button>
                    <button type="button" class="lark-doc-secure-link-copy" :disabled="ed.shareLinkBusy || !!ed.shareLinkPending || !ed.shareLinkState || !ed.shareLinkState.passwordAvailable" @click="ed.copyLinkAndPassword()">复制链接和密码</button>
                  </div>
                </div>
              </template>
            </div>
            <div class="lark-doc-permission-desc">{{ ed.shareScopeText }} 组织免密访问尚未接入可信组织身份。</div>
          </div>

          <!-- 谁可以查看、添加、移除协作者（③ y297/327/367），带次级说明。 -->
          <div class="lark-doc-permission-item">
            <div class="lark-doc-permission-row">
              <span class="lark-doc-permission-item-title">谁可以查看、添加、移除协作者</span>
            </div>
            <div class="lark-doc-permission-value">
              <LarkDocSelect
                class="lark-doc-permission-scope-select"
                aria-label="谁可以查看、添加、移除协作者"
                :value="permissionValue('collaborators')"
                :options="permissionOptions('collaborators')"
                :disabled="permissionDisabled"
                :placeholder="permissionPlaceholder"
                :hover-open="false"
                :menu-min-width="128"
                @change="changePermission('collaborators', $event)"
              />
            </div>
            <div
              v-if="!ed.shareRemote"
              class="lark-doc-permission-desc"
            >
              仅组织内的用户可以查看、添加、移除协作者
            </div>
          </div>

          <!-- 谁可以复制内容（③ y421/451）。 -->
          <div class="lark-doc-permission-item">
            <div class="lark-doc-permission-row">
              <span class="lark-doc-permission-item-title">谁可以复制内容</span>
            </div>
            <div class="lark-doc-permission-value">
              <LarkDocSelect
                class="lark-doc-permission-scope-select"
                aria-label="谁可以复制内容"
                :value="permissionValue('copy')"
                :options="permissionOptions('copy')"
                :disabled="permissionDisabled"
                :placeholder="permissionPlaceholder"
                :hover-open="false"
                :menu-min-width="128"
                @change="changePermission('copy', $event)"
              />
            </div>
          </div>

          <!-- 谁可以创建副本、打印和下载（③ y515/545）。 -->
          <div class="lark-doc-permission-item">
            <div class="lark-doc-permission-row">
              <span class="lark-doc-permission-item-title">谁可以创建副本、打印和下载</span>
            </div>
            <div class="lark-doc-permission-value">
              <LarkDocSelect
                class="lark-doc-permission-scope-select"
                aria-label="谁可以创建副本、打印和下载"
                :value="permissionValue('duplicate')"
                :options="permissionOptions('duplicate')"
                :disabled="permissionDisabled"
                :placeholder="permissionPlaceholder"
                :hover-open="false"
                :menu-min-width="128"
                @change="changePermission('duplicate', $event)"
              />
            </div>
          </div>

          <!-- 谁可以评论（③ y609/639）。 -->
          <div class="lark-doc-permission-item">
            <div class="lark-doc-permission-row">
              <span class="lark-doc-permission-item-title">谁可以评论</span>
            </div>
            <div class="lark-doc-permission-value">
              <LarkDocSelect
                class="lark-doc-permission-scope-select"
                aria-label="谁可以评论"
                :value="permissionValue('comment')"
                :options="permissionOptions('comment')"
                :disabled="permissionDisabled"
                :placeholder="permissionPlaceholder"
                :hover-open="false"
                :menu-min-width="128"
                @change="changePermission('comment', $event)"
              />
            </div>
          </div>

          <!-- 更多高级设置 折叠头 437×22（③ y736）。展开后飞书会让 Dialog 整体上收 100px
               以容纳更多项；这里不做尺寸动画，只切换显隐（④ 末四行的顺序照抄）。 -->
          <button
            type="button"
            class="lark-doc-permission-collapse-head"
            :aria-expanded="ed.permissionAdvancedOpen ? 'true' : 'false'"
            @click="ed.toggleAdvancedSettings()"
          >
            <span
              class="lark-doc-permission-caret"
              aria-hidden="true"
            >{{ ed.permissionAdvancedOpen ? '▾' : '▸' }}</span>
            <span>更多高级设置</span>
          </button>
          <template v-if="ed.permissionAdvancedOpen && !ed.shareRemote">
            <div class="lark-doc-permission-group-title">
              企业信息公开设置
            </div>
            <div class="lark-doc-permission-item">
              <div class="lark-doc-permission-row">
                <span class="lark-doc-permission-item-title">文档所有者上级</span>
                <button
                  type="button"
                  class="lark-doc-permission-switch"
                  :class="{ 'is-on': ed.permissionValues.ownerLeaderAutoPass }"
                  role="switch"
                  aria-label="文档所有者上级 申请访问时自动通过"
                  :aria-checked="ed.permissionValues.ownerLeaderAutoPass ? 'true' : 'false'"
                  @click="toggleValue('ownerLeaderAutoPass')"
                />
              </div>
              <div class="lark-doc-permission-desc">
                申请访问时自动通过
              </div>
            </div>
            <div class="lark-doc-permission-item">
              <div class="lark-doc-permission-row">
                <span class="lark-doc-permission-item-title">文档所有者上级</span>
                <button
                  type="button"
                  class="lark-doc-permission-switch"
                  :class="{ 'is-on': ed.permissionValues.ownerLeaderSearchable }"
                  role="switch"
                  aria-label="文档所有者上级 可搜索和访问该文档"
                  :aria-checked="ed.permissionValues.ownerLeaderSearchable ? 'true' : 'false'"
                  @click="toggleValue('ownerLeaderSearchable')"
                />
              </div>
              <div class="lark-doc-permission-desc">
                可搜索和访问该文档
              </div>
            </div>
            <div class="lark-doc-permission-item">
              <div class="lark-doc-permission-row">
                <span class="lark-doc-permission-item-title">谁可以查看访问者头像和点赞者头像</span>
              </div>
              <div class="lark-doc-permission-value">
                <select
                  class="lark-doc-permission-select"
                  aria-label="谁可以查看访问者头像和点赞者头像"
                  :value="ed.permissionValues.visitorAvatar"
                  @change="ed.setPermissionValue('visitorAvatar', $event.target.value)"
                >
                  <option
                    v-for="option in ed.sharePermissionOptions"
                    :key="option"
                    :value="option"
                  >
                    {{ option }}
                  </option>
                </select>
              </div>
            </div>
            <div class="lark-doc-permission-item">
              <div class="lark-doc-permission-row">
                <span class="lark-doc-permission-item-title">谁可以在文档内申请引用文档访问权限</span>
              </div>
              <div class="lark-doc-permission-value">
                <select
                  class="lark-doc-permission-select"
                  aria-label="谁可以在文档内申请引用文档访问权限"
                  :value="ed.permissionValues.requestAccess"
                  @change="ed.setPermissionValue('requestAccess', $event.target.value)"
                >
                  <option
                    v-for="option in ed.sharePermissionOptions"
                    :key="option"
                    :value="option"
                  >
                    {{ option }}
                  </option>
                </select>
              </div>
              <div class="lark-doc-permission-desc">
                仅可管理权限的用户可以申请
              </div>
            </div>
          </template>
          <div v-else-if="ed.permissionAdvancedOpen">
            <div class="lark-doc-permission-item">
              <div class="lark-doc-permission-row"><span class="lark-doc-permission-item-title">谁可以查看访问者头像和点赞者头像</span></div>
              <div class="lark-doc-permission-value">
                <LarkDocSelect class="lark-doc-permission-scope-select" aria-label="谁可以查看访问者头像和点赞者头像"
                  :value="permissionValue('visitorAvatar')" :options="permissionOptions('visitorAvatar')"
                  :disabled="permissionDisabled || !remoteSettings || !remoteSettings.supported.visitorAvatar"
                  :placeholder="permissionPlaceholder" :hover-open="false" :menu-min-width="128"
                  @change="changePermission('visitorAvatar', $event)" />
              </div>
            </div>
            <div role="group"
            aria-label="暂不支持的高级设置"
          >
            <div
              v-for="item in ed.sharePermissionAdvancedItems.filter(item => item.id !== 'visitorAvatar')"
              :key="item.id"
              class="lark-doc-permission-item"
            >
              <span class="lark-doc-permission-item-title">{{ item.title }}</span>
              <span v-if="item.desc">{{ item.desc }}</span>
              <button
                v-if="item.type !== 'group'"
                type="button"
                disabled
                title="当前服务未提供此项组织权限设置"
              >
                暂不支持
              </button>
            </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 仅copy切到managers触发二次确认；文案按已取得的英文fallback翻译，像素待验。 -->
    <div
      v-if="copyConfirmOpen"
      ref="copyConfirmation"
      class="lark-doc-share-confirm suite-config-security-modal"
      role="dialog"
      aria-modal="true"
      aria-label="确认更改复制权限"
      tabindex="-1"
      @keydown.esc.stop.prevent="cancelCopyPermission(true)"
    >
      <div class="lark-doc-share-confirm-header">
        <h3 class="lark-doc-share-confirm-title">
          确认设置为仅拥有“可管理权限（包括我）”的用户？
        </h3>
      </div>
      <div class="lark-doc-share-confirm-body">
        <p class="lark-doc-share-confirm-text">
          设置此选项后，拥有编辑权限的用户将无法复制该内容，编辑体验将受影响。
        </p>
      </div>
      <div class="lark-doc-share-confirm-footer">
        <button
          type="button"
          class="lark-doc-share-btn-outlined"
          @click="cancelCopyPermission(true)"
        >
          取消
        </button>
        <button
          type="button"
          class="lark-doc-share-btn-filled"
          @click="confirmCopyPermission"
        >
          确认
        </button>
      </div>
    </div>

    <!-- 「提示」二次确认 500×262 @(506,344)（⑤-2）。只在**开启**加密链接时弹；
         关闭侧 04 只记了「`link_share_entity` 回落到普通枚举」，没有确认弹窗。 -->
    <div
      v-if="ed.secureLinkConfirmOpen"
      class="lark-doc-share-confirm"
      role="dialog"
      aria-label="提示"
    >
      <div class="lark-doc-share-confirm-header">
        <div class="lark-doc-permission-head-row">
          <h3 class="lark-doc-share-confirm-title">
            提示
          </h3>
          <button
            type="button"
            class="lark-doc-share-close"
            aria-label="关闭"
            @click="ed.cancelSecureLinkConfirm()"
          >
            ✕
          </button>
        </div>
      </div>
      <div class="lark-doc-share-confirm-body">
        <!-- 三句正文**必抄**（开加密链接的风险告知，不能省）。第 1 句在采集日志里被截断，
             句号是补的（见 shareMixin 文件头「待定」D）。 -->
        <p class="lark-doc-share-confirm-text">
          {{ ed.shareRemote ? '该功能开启后，互联网上获得链接和密码的人能够访问该文档。' : SECURE_CONFIRM_MESSAGES[0] }}
        </p>
        <p class="lark-doc-share-confirm-text">
          {{ SECURE_CONFIRM_MESSAGES[1] }}
        </p>
        <p class="lark-doc-share-confirm-text">
          {{ SECURE_CONFIRM_MESSAGES[2] }}
          <span class="lark-doc-share-confirm-link">服务协议</span>
          <span class="lark-doc-share-confirm-link">隐私政策</span>
        </p>
      </div>
      <div class="lark-doc-share-confirm-footer">
        <button
          type="button"
          class="lark-doc-share-btn-outlined"
          @click="ed.cancelSecureLinkConfirm()"
        >
          取消
        </button>
        <button
          type="button"
          class="lark-doc-share-btn-filled"
          @click="ed.confirmSecureLink()"
        >
          确认
        </button>
      </div>
    </div>

    <!-- 修改密码弹窗 420×312 @(546,319)（⑤-5）。飞书里它是**独立小 Dialog**
         （DOM 在 body 末尾另起一份）；本仓受 Vue 2 单根约束只能留在本层内，
         但它是 `position: fixed` 且祖先无 transform，视觉位置等价。 -->
    <div
      v-if="ed.passwordDialogOpen"
      class="lark-doc-share-password"
      role="dialog"
      aria-label="修改密码"
    >
      <div class="lark-doc-share-password-header">
        <h3 class="lark-doc-share-password-title">
          修改密码
        </h3>
        <button
          type="button"
          class="lark-doc-share-close"
          aria-label="关闭"
          @click="ed.closePasswordDialog()"
        >
          ✕
        </button>
      </div>
      <div class="lark-doc-share-password-body">
        <div class="lark-doc-share-password-content">
          <div class="lark-doc-share-password-input-row">
            <!-- 🔴 **不加 maxlength**：实测无该属性，25 位也能输进去（⑤-5）。 -->
            <div class="lark-doc-share-password-input">
              <input
                :value="ed.passwordDraft"
                aria-label="请输入新密码"
                placeholder="请输入新密码"
                @input="ed.setPasswordDraft($event.target.value)"
              >
              <button
                v-if="ed.passwordDraft"
                type="button"
                class="lark-doc-share-password-clear"
                aria-label="清空"
                @click="ed.setPasswordDraft('')"
              >
                ✕
              </button>
            </div>
            <button
              type="button"
              class="lark-doc-share-btn-outlined lark-doc-share-password-random"
              @click="ed.randomizePasswordDraft()"
            >
              <!-- 骰子 / 刷新类前置图标 14×14（04 只记了尺寸没给 SVG）。 -->
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <rect
                  x="2.5"
                  y="2.5"
                  width="11"
                  height="11"
                  rx="2"
                /><path d="M12 6.5a3.5 3.5 0 0 1-3 3.4" /><path d="M13.2 10.4L12.6 12l-1.6-.6" />
              </svg>
              <span>随机生成</span>
            </button>
          </div>

          <!-- 规则框 372×62；出现不支持字符时 62 → 88（+26）。
               🔴 **无 animation**：校验失败不 shake，反馈只由 toast 承担（⑤-9）。 -->
          <div class="lark-doc-share-password-rules">
            <div
              v-for="rule in ed.sharePasswordRules"
              :key="rule.id"
              class="lark-doc-share-password-rule"
              :class="`is-${rule.state}`"
            >
              <span class="lark-doc-share-password-rule-icon">
                <!-- 🔴 normal 与 success **是同一段 SVG（SucceedFilled），只换外层 color**
                     （⑤-7）；error 才换成另一段「圆圈 + ×」。 -->
                <svg
                  v-if="rule.state !== 'error'"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M11.996 22.98c-6.067 0-10.983-4.918-10.983-10.984S5.93 1.013 11.996 1.013c6.066 0 10.983 4.917 10.983 10.983 0 6.066-4.917 10.984-10.983 10.984Z"
                    fill="currentColor"
                  />
                  <path
                    d="M17.537 10.746a1.38 1.38 0 0 0-.005-1.95 1.378 1.378 0 0 0-1.95-.005l-4.89 4.89-2.285-2.285a1.375 1.375 0 0 0-1.942.012 1.373 1.373 0 0 0-.013 1.942c1.178 1.175 2.356 2.348 3.53 3.528.392.394 1.03.394 1.422 0 2.037-2.051 4.087-4.09 6.133-6.132Z"
                    fill="var(--ld-share-surface)"
                  />
                </svg>
                <svg
                  v-else
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M12 23C5.925 23 1 18.075 1 12S5.925 1 12 1s11 4.925 11 11-4.925 11-11 11Z"
                    fill="currentColor"
                  />
                  <path
                    d="M7.465 8.879 10.585 12l-3.12 3.121a1 1 0 1 0 1.414 1.414L12 13.415l3.121 3.12a1 1 0 1 0 1.415-1.414L13.414 12l3.122-3.121a1 1 0 0 0-1.415-1.415l-3.12 3.122-3.122-3.122A1 1 0 0 0 7.465 8.88Z"
                    fill="var(--ld-share-surface)"
                  />
                </svg>
              </span>
              <span class="lark-doc-share-password-rule-text">{{ rule.text }}</span>
            </div>
          </div>

          <p class="lark-doc-share-password-hints">
            安全提示：请勿使用个人常用或其他平台中的密码
          </p>

          <!-- footer 与 body 之间**没有 border-top**（⑤-5 末句）。 -->
          <div class="lark-doc-share-password-footer">
            <button
              type="button"
              class="lark-doc-share-btn-outlined"
              @click="ed.closePasswordDialog()"
            >
              取消
            </button>
            <!-- 🔴 「保存」**恒可点**：⑤-9 九档输入实测 disabled:false / opacity 1 /
                 bg 恒 rgb(20,86,240)。非法密码是提交时静默拦截，不是前置禁用。 -->
            <button
              type="button"
              class="lark-doc-share-btn-filled"
              :disabled="ed.sharePasswordSaveDisabled"
              @click="ed.saveSharePassword()"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
/**
 * 权限设置 Dialog（P6b-03 · 分享的二级面板）。
 *
 * 规格：requirements/04 §4.1.1（① 触发链 / ② 层级尺寸 / ③ 行级像素 / ④ 配置项全集 /
 * ⑤ 加密链接全链路 batch468–479）。
 *
 * 五条负结论（别实现，改之前先回来读）：
 *   1. **没有 footer / 没有「保存」**。② 末行实测 `.ud__modal__footer` 为 **null**：
 *      改完即关。加一个底部保存按钮就是偏离实景。
 *   2. **没有「链接有效期」，也没有「水印」**。⑤-11 在勾选展开态再扫一遍
 *      `/有效期|到期|失效|水印/` **0 命中** —— 不是没采到，是 UI 上不存在。
 *   3. **勾选「启用加密链接」必须走「提示」二次确认**才落 `link_share_entity:4`；
 *      **取消 = 丢弃**（复选框回未勾选、密码区不长出来）。直接勾上去就生效是错的。
 *      关闭加密链接则**不需要**确认（04 只记了开启侧的确认）。
 *   4. **规则图标 normal 与 success 是同一段 SVG，只换 color**（⑤-7），不是两个图标；
 *      校验失败**不做 shake**，只出 toast（⑤-9）。
 *   5. **别给密码输入加 maxlength**。⑤-5 实测「无 `maxlength`」，25 位照样输得进去，
 *      加了会让「超长 → 长度规则回落 normal」这条分支永远走不到。
 *
 * 本地模式沿用shareMixin；远端只显示服务端确认值，未决原操作由授权端口保留。
 */
import { SECURE_LINK_TIP, SECURE_CONFIRM_MESSAGES } from './editor/shareMixin'
import LarkDocSelect from './LarkDocSelect'

export default {
  name: 'LarkDocPermissionDialog',
  components: { LarkDocSelect },
  props: {
    ed: { type: Object, required: true },
  },
  data() { return { remoteSettings: null, remoteLoading: false, remoteBusy: false, remoteError: '', pendingOperation: '', copyConfirmOpen: false } },
  computed: {
    permissionDisabled() {
      return !this.ed.shareCan('canManagePermission') || (this.ed.shareRemote &&
        (!this._settingsViewScope?.current() || !this.remoteSettings?.canManage || this.remoteLoading || this.remoteBusy || this.copyConfirmOpen || Boolean(this.pendingOperation)))
    },
    permissionPlaceholder() {
      return this.ed.shareRemote ? (this.remoteLoading ? '正在载入…' : this.pendingOperation ? '待确认' : '暂不可用') : ''
    },
    scopeOptions() {
      return ['可阅读的用户', '可编辑的用户', '可管理的用户'].map(value => ({ value, label: value }))
    },
    commentOptions() {
      return this.scopeOptions.slice(0, 2)
    },
    SECURE_LINK_TIP() {
      return SECURE_LINK_TIP
    },
    SECURE_CONFIRM_MESSAGES() {
      return SECURE_CONFIRM_MESSAGES
    },
  },
  watch: { 'ed.session'() { this.bindRemotePermissions() } },
  mounted() { this.bindRemotePermissions() },
  beforeDestroy() { this.cancelCopyPermission(); this._settingsToken = null; this._settingsStops?.forEach(stop => stop()) },
  methods: {
    permissionValue(key) { return this.ed.shareRemote ? (this._settingsViewScope?.current() ? this.remoteSettings?.values[key] || '' : '') : this.ed.permissionValues[key] },
    permissionOptions(key) {
      if (!this.ed.shareRemote) return key === 'comment' ? this.commentOptions : this.scopeOptions
      const labels = { readers: '可阅读的用户', editors: '可编辑的用户', managers: '可管理的用户' }
      return (this._settingsViewScope?.current() ? this.remoteSettings?.supported[key] || [] : []).map(value => ({ value, label: labels[value] }))
    },
    openCollaborators() {
      if (!this.ed.shareCan('canManagePermission')) return
      this.ed.closePermissionDialog()
      if (!this.ed.sharePopoverOpen) this.ed.openDocumentSharePopover()
      else void this.ed.loadShareMembers()
    },
    invalidateRemotePermissions() {
      this.cancelCopyPermission()
      this._settingsToken = null; this._settingsViewScope = null; this.remoteSettings = null; this.remoteLoading = false; this.remoteBusy = false
      this.remoteError = this.ed.shareCan('canManagePermission') ? '' : '你暂时无权更改权限设置。'
    },
    bindRemotePermissions() {
      this._settingsStops?.forEach(stop => stop()); this._settingsStops = []; this.pendingOperation = ''; this._settingsRefreshId = ''; this.invalidateRemotePermissions()
      const session = this.ed.session
      if (session?.on) {
        this._settingsStops.push(session.on('comments-reset', reason => { this.invalidateRemotePermissions(); if (reason !== 'authorization-required') { this.pendingOperation = ''; this._settingsRefreshId = '' } }))
        this._settingsStops.push(session.on('provider-changed', event => { if (event.name === 'authorization') { this.pendingOperation = ''; this._settingsRefreshId = ''; this.invalidateRemotePermissions() } }))
        this._settingsStops.push(session.on('capabilities', () => {
          if (!this.ed.shareCan('canManagePermission')) this.invalidateRemotePermissions()
          else if (this.ed.shareRemote && !this.remoteLoading && !this.remoteBusy) void this.loadRemotePermissions()
        }))
      }
      if (this.ed.shareRemote) void this.loadRemotePermissions()
    },
    settingsScope() {
      const session = this.ed.session, provider = session?.getProvider?.('authorization'), principal = session?.user?.id
      const documentId = session?.documentId, identity = session?._privateIdentityGeneration, auth = session?._authorizationGeneration
      const sameContext = () => !this.ed._isDestroyed && session === this.ed.session && provider === session?.getProvider?.('authorization') &&
        principal === session?.user?.id && documentId === session?.documentId && identity === session?._privateIdentityGeneration && !session?._destroyed
      const owner = () => !this._isDestroyed && !this._isBeingDestroyed && sameContext()
      return { session, provider, documentId, owner, sameContext, current: () => owner() && auth === session?._authorizationGeneration && this.ed.shareCan('canManagePermission') }
    },
    async acceptRemoteSettings(result, scope, token, publish = true) {
      if (!scope.sameContext()) return null
      if (result.docId !== scope.documentId) throw new Error('SHARING_SETTINGS_CONTEXT_CHANGED')
      if (publish && scope.current() && this._settingsToken === token) { this._settingsViewScope = scope; this.remoteSettings = result; this.pendingOperation = ''; this.remoteError = '' }
      if (result.operationId && this._settingsRefreshId !== result.operationId) {
        this._settingsRefreshId = result.operationId
        try { await scope.session.refreshCapabilities() }
        catch { if (scope.owner()) { this._settingsRefreshId = ''; this.remoteError = '权限刷新未完成，请重新载入。' } }
      }
      return result
    },
    async loadRemotePermissions() {
      if (!this.ed.shareRemote || this.remoteLoading || this.remoteBusy) return null
      if (!this.ed.shareCan('canManagePermission')) { this.invalidateRemotePermissions(); return null }
      let scope = this.settingsScope(), token = {}; this._settingsToken = token
      this.remoteSettings = null; this.remoteLoading = true; this.remoteError = ''
      try {
        if (typeof scope.provider?.getSharingSettings !== 'function' || typeof scope.provider.getSharingSettingsOperation !== 'function') throw new Error('SHARING_SETTINGS_UNAVAILABLE')
        const operation = await scope.provider.getSharingSettingsOperation()
        if (!scope.current() || this._settingsToken !== token) return null
        this.pendingOperation = operation?.operationId || ''
        if (this.pendingOperation) {
          const confirmed = await scope.provider.querySharingSettingsOperation(this.pendingOperation)
          await this.acceptRemoteSettings(confirmed, scope, token, false)
          if (!scope.owner() || this._settingsToken !== token) return null
          this.pendingOperation = ''
          scope = this.settingsScope(); token = {}; this._settingsToken = token
        }
        const result = await scope.provider.getSharingSettings()
        return await this.acceptRemoteSettings(result, scope, token)
      } catch (error) {
        if (scope.owner() && this._settingsToken === token) {
          this.remoteSettings = null
          if (error.operationId && error.status === 'unknown') this.pendingOperation = error.operationId
          this.remoteError = this.pendingOperation ? '更改结果待确认，请核对原操作。' : '权限设置暂不可用，请重试。'
        }
        return null
      } finally { if (this._settingsToken === token) this.remoteLoading = false }
    },
    async changePermission(key, value) {
      if (!this.ed.shareRemote) return this.ed.setPermissionValue(key, value)
      if (this.permissionDisabled || !this._settingsViewScope?.current() || !this.remoteSettings?.supported[key]?.includes(value) || value === this.remoteSettings.values[key]) return null
      if (key === 'copy' && value === 'managers') {
        this._copyConfirmIntent = { scope: this._settingsViewScope, revision: this.remoteSettings.settingsRevision }
        this.copyConfirmOpen = true
        this.$nextTick(() => { if (this.copyConfirmOpen) this.$refs?.copyConfirmation?.focus() })
        return null
      }
      return this.submitPermission(key, value)
    },
    cancelCopyPermission(restoreFocus = false) {
      const intent = this._copyConfirmIntent
      this.copyConfirmOpen = false; this._copyConfirmIntent = null
      if (restoreFocus && intent) this.$nextTick(() => {
        if (intent.scope.current() && this.ed.permissionDialogOpen) this.$el.querySelector('[role="combobox"][aria-label="谁可以复制内容"]')?.focus()
      })
    },
    confirmCopyPermission() {
      const intent = this._copyConfirmIntent
      this.cancelCopyPermission()
      if (!intent?.scope.current() || intent.revision !== this.remoteSettings?.settingsRevision) return null
      return this.submitPermission('copy', 'managers')
    },
    async submitPermission(key, value) {
      if (this.permissionDisabled || !this._settingsViewScope?.current() || !this.remoteSettings?.supported[key]?.includes(value) || value === this.remoteSettings.values[key]) return null
      const scope = this.settingsScope(), token = {}; this._settingsToken = token; this.remoteBusy = true; this.remoteError = ''
      try {
        const result = await scope.provider.requestSharingSettings({ expectedRevision: this.remoteSettings.settingsRevision, changes: { [key]: value } })
        return await this.acceptRemoteSettings(result, scope, token)
      } catch (error) {
        if (scope.owner() && (this._settingsToken === token || !this._settingsToken)) {
          if (error.operationId && error.status === 'unknown') { this.pendingOperation = error.operationId; this.remoteSettings = null }
          this.remoteError = this.pendingOperation ? '更改结果待确认，请核对原操作。' : '权限设置未能更改，请重试。'
          if (scope.current() && error.httpStatus === 409) {
            this.remoteBusy = false; await this.loadRemotePermissions()
            if (scope.current()) this.remoteError = '权限设置已变化，请重新选择。'
          }
        }
        return null
      } finally { if (this._settingsToken === token) this.remoteBusy = false }
    },
    closeAll() {
      this.cancelCopyPermission()
      this.ed.closePermissionDialog()
    },
    toggleValue(id) {
      this.ed.setPermissionValue(id, !this.ed.permissionValues[id])
    },
  },
}
</script>

<style>
/* 四项基础权限实测：trigger104×32，菜单128宽，每项32；高级项仍保留原下拉。 */
.lark-doc .lark-doc-permission-dialog .lark-doc-permission-scope-select .lark-doc-select-trigger {
  box-sizing: border-box;
  width: 104px;
  height: 32px;
  padding: 0 2px;
  border: 0;
  background: transparent;
  color: var(--ld-share-text);
  font-size: 14px;
  line-height: 22px;
}

.lark-doc .lark-doc-permission-dialog .lark-doc-permission-scope-select .lark-doc-select-menu {
  z-index: 1001;
  box-sizing: border-box;
  width: 128px;
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 16px);
  gap: 0;
  padding: 2px 0;
  border: 1px solid var(--ld-share-border);
  border-radius: 6px;
  box-shadow: var(--ld-shadow-chrome);
}

.lark-doc .lark-doc-permission-dialog .lark-doc-permission-scope-select .lark-doc-select-menu > button {
  box-sizing: border-box;
  height: 32px;
  min-height: 32px;
  margin: 0 3px;
  padding: 4px 8px;
  border-radius: 4px;
  color: var(--ld-share-text);
  font-size: 14px;
  line-height: 22px;
}
</style>
