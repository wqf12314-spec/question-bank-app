export const ROLES = Object.freeze({
  LEARNER: "LEARNER",
  EDITOR: "EDITOR",
  ADMIN: "ADMIN",
});

export function canAccess(user, allowedRoles = []) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  if (roles.length === 0) return true;
  return Boolean(user?.role && roles.includes(user.role));
}

export function filterByPermission(items, user) {
  return items.filter((item) => canAccess(user, item.roles));
}

function setVisibility(element, allowed) {
  if (allowed) {
    element.style.display = element.dataset.permissionDisplay || "";
    element.removeAttribute("aria-hidden");
    delete element.dataset.permissionDisplay;
    return;
  }

  if (
    !Object.prototype.hasOwnProperty.call(element.dataset, "permissionDisplay")
  ) {
    element.dataset.permissionDisplay = element.style.display;
  }
  element.style.display = "none";
  element.setAttribute("aria-hidden", "true");
}

export function createPermissionDirective(getUser) {
  function update(element, binding) {
    setVisibility(element, canAccess(getUser(), binding.value));
  }

  return {
    mounted: update,
    updated: update,
  };
}
