import { cx } from "@/components/cx";
import styles from "./Spinner.module.css";

/** Лоудер для кнопок и статусов: оранжевые ромбы поднимаются друг за другом */
export function Spinner({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cx(styles.loader, className)}>
      <i className={styles.diamond} />
      <i className={styles.diamond} />
      <i className={styles.diamond} />
      <i className={styles.diamond} />
    </span>
  );
}
