import { BookOpen, Bug, Code, ExternalLink, Scale } from 'lucide-react';
import { Logo, Modal } from '@/shared/ui';
import './about.css';

const VERSION = __APP_VERSION__;
const REPOSITORY = __APP_REPOSITORY__;

/** A path on the default branch, or the repository itself. */
const repo = (path = '') => (REPOSITORY ? `${REPOSITORY}${path}` : '');

const LINKS = [
  { label: 'Source code', href: repo(), icon: Code },
  { label: 'Documentation', href: repo('#readme'), icon: BookOpen },
  { label: 'Report an issue', href: repo('/issues'), icon: Bug },
  { label: 'License: GNU AGPL v3.0', href: repo('/blob/main/LICENSE'), icon: Scale },
].filter((link) => link.href);

/**
 * What this is, which version is running, and where its source lives. The
 * source link is not decoration: the AGPL asks anyone who lets people use a
 * modified copy over a network to offer them its source, and this is where a
 * person using the app would look for it.
 */
export function AboutModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="About" width={360} onClose={onClose}>
      <div className="cg-about">
        <div className="cg-about__head">
          <Logo size={40} />
          <div>
            <div className="cg-about__name">Cartographer</div>
            <div className="cg-about__version">Version {VERSION}</div>
          </div>
        </div>

        <p className="cg-about__blurb">
          A self-hosted canvas for mapping how things fit together, where every node is a markdown
          file you own.
        </p>

        {LINKS.length > 0 && (
          <ul className="cg-about__links">
            {LINKS.map(({ label, href, icon: Icon }) => (
              <li key={label}>
                <a className="cg-about__link" href={href} target="_blank" rel="noreferrer">
                  <Icon size={14} aria-hidden />
                  <span>{label}</span>
                  <ExternalLink size={12} aria-hidden className="cg-about__out" />
                </a>
              </li>
            ))}
          </ul>
        )}

        <p className="cg-about__legal">
          © 2026 Nikto655. Free software under the GNU Affero General Public License v3.0. The
          Cartographer name and logo are trademarks.
        </p>
      </div>
    </Modal>
  );
}
