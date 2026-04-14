import { Toaster as Sonner } from "sonner";

const Toaster = ({
  ...props
}) => {
  return (
    <Sonner
      className="toaster group"
      {...props} />
  );
}

export { Toaster }
