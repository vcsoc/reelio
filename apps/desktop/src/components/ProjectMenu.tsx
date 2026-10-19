import { Info, Menu, Download } from "lucide-react";
import { UpdateDialog } from "../features/updates/UpdateDialog";
import { call, desktop } from "../services/desktop";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Action = {
  label: string;
  shortcut?: string;
  icon: ReactNode;
  disabled: boolean;
  select: () => void;
};
export function ProjectMenu({ actions }: { actions: Action[] }) {
  const [open, setOpen] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const about = useRef<HTMLDialogElement>(null);
  const [version, setVersion] = useState(
    desktop ? "Loading..." : "Browser preview",
  );
  const [aboutError, setAboutError] = useState<string>();
  const showAbout = () => {
    close(true);
    setAboutError(undefined);
    about.current?.showModal();
    if (desktop)
      void call<string>("app_version")
        .then(setVersion)
        .catch((error: Error) => {
          setVersion("Unavailable");
          setAboutError(error.message);
        });
  };
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const initialFocus = useRef("first");
  const items = () =>
    Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>(
        "[role=menuitem]:not(:disabled)",
      ) ?? [],
    );
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  useLayoutEffect(() => {
    if (!open) return;
    const buttons = items();
    (initialFocus.current === "last" ? buttons.at(-1) : buttons[0])?.focus();
    if (!buttons.length) menu.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);
  return (
    <div className="project-menu" ref={root}>
      <button
        type="button"
        className="icon-button"
        ref={trigger}
        title="Project menu"
        aria-label="Project menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "project-actions-menu" : undefined}
        onClick={() => {
          initialFocus.current = "first";
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            initialFocus.current = event.key === "ArrowUp" ? "last" : "first";
            setOpen(true);
          } else if (event.key === "Escape") close();
        }}
      >
        <Menu size={18} />
      </button>
      {open && (
        <div
          id="project-actions-menu"
          className="project-menu-items"
          role="menu"
          aria-label="Project actions"
          tabIndex={-1}
          ref={menu}
          onKeyDown={(event) => {
            const buttons = items();
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        buttons.length) %
                      buttons.length;
              buttons[next]?.focus();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close(true);
            } else if (event.key === "Tab") close(true);
            else if (event.ctrlKey || event.metaKey) close();
          }}
        >
          {actions.map((action) => (
            <button
              type="button"
              role="menuitem"
              key={action.label}
              aria-label={action.label}
              title={
                action.shortcut
                  ? `${action.label} (${action.shortcut})`
                  : action.label
              }
              disabled={action.disabled}
              onClick={() => {
                close(true);
                action.select();
              }}
            >
              {action.icon}
              <span>{action.label}</span>
              {action.shortcut && (
                <span className="menu-shortcut">{action.shortcut}</span>
              )}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            disabled={!desktop}
            onClick={() => {
              close(true);
              setUpdatesOpen(true);
            }}
          >
            <Download size={17} />
            <span>Check for updates</span>
          </button>
          <button type="button" role="menuitem" onClick={showAbout}>
            <Info size={17} />
            <span>About Reelio</span>
          </button>
        </div>
      )}
      {updatesOpen && (
        <UpdateDialog
          onClose={() => {
            setUpdatesOpen(false);
            trigger.current?.focus();
          }}
        />
      )}
      <dialog
        ref={about}
        className="settings-dialog about-dialog"
        aria-labelledby="about-reelio-title"
        onClose={() => trigger.current?.focus()}
      >
        <h2 id="about-reelio-title">About Reelio</h2>
        <p className="about-version">Version {version}</p>
        <p>Developed by Chris Visser</p>
        <p>
          <a
            href="https://github.com/vcsoc/reelio"
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              if (!desktop) return;
              event.preventDefault();
              setAboutError(undefined);
              void call<void>("open_project_homepage").catch((error: Error) =>
                setAboutError(error.message),
              );
            }}
          >
            github.com/vcsoc/reelio
          </a>
        </p>
        {aboutError && <p role="alert">{aboutError}</p>}
        <button type="button" onClick={() => about.current?.close()}>
          Close
        </button>
      </dialog>
    </div>
  );
}
