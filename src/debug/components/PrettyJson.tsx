/* eslint-disable react-x/no-nested-component-definitions */
import React, { useState } from "react";
import { Icon, Link, Loader } from "@stellar/design-system";

import { isEmptyObject } from "../util/isEmptyObject";
import { AnyObject } from "../types/types";

export type CustomKeyValueLinkMap = {
  [key: string]: {
    text?: string;
    getHref: (value: string, key?: string) => string;
    condition?: (
      val: string,
      parentKey?: string,
      isRpcResponse?: boolean,
    ) => boolean;
  };
};

type PrettyJsonProps = {
  json: unknown;
  customKeyValueLinkMap?: CustomKeyValueLinkMap;
  customValueRenderer?: (
    item: unknown,
    key: string,
    parentKey?: string,
  ) => React.ReactNode | null;
  customKeyRenderer?: (item: unknown, key: string) => React.ReactNode | null;
  isLoading?: boolean;
  isCollapsible?: boolean;
};

type Char = "{" | "}" | "[" | "]";

const styles = {
  prettyJson: {
    fontFamily: "var(--sds-ff-monospace)",
    fontSize: "14px",
    lineHeight: "20px",
    fontWeight: "var(--sds-fw-medium)",
    letterSpacing: "-0.5px",
  } as React.CSSProperties,
  loaderContainer: {
    display: "flex",
    justifyContent: "center",
  } as React.CSSProperties,
  nested: {
    paddingLeft: "16px",
  } as React.CSSProperties,
  inline: {
    display: "flex",
    gap: "4px",
    position: "relative",
  } as React.CSSProperties,
  clickable: {
    cursor: "pointer",
  } as React.CSSProperties,
  valueString: {
    color: "var(--sds-clr-navy-11)",
  } as React.CSSProperties,
  valueNumber: {
    color: "var(--sds-clr-lime-11)",
  } as React.CSSProperties,
  valueBoolean: {
    color: "var(--sds-clr-pink-11)",
  } as React.CSSProperties,
  defaultColor: {
    color: "var(--sds-clr-gray-12)",
  } as React.CSSProperties,
  key: {
    whiteSpace: "nowrap",
    color: "var(--sds-clr-gray-12)",
  } as React.CSSProperties,
  expandIcon: {
    width: "20px",
    height: "20px",
    position: "absolute",
    top: "50%",
    left: "-20px",
    transform: "translate(0, -40%)",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "flex-start",
  } as React.CSSProperties,
  expandIconSvg: {
    display: "block",
    width: "16px",
    height: "16px",
    stroke: "var(--sds-clr-gray-10)",
  } as React.CSSProperties,
  expandSize: {
    color: "var(--sds-clr-gray-09)",
    fontSize: "12px",
    marginLeft: "4px",
  } as React.CSSProperties,
  successColor: {
    color: "var(--sds-clr-green-11)",
  } as React.CSSProperties,
  errorColor: {
    color: "var(--sds-clr-red-11)",
  } as React.CSSProperties,
};

const isValidUrl = (url: string) => {
  if (!url.startsWith("http")) {
    return false;
  }

  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

export const PrettyJson = ({
  json,
  customKeyValueLinkMap,
  customValueRenderer,
  customKeyRenderer,
  isLoading,
  isCollapsible = true,
}: PrettyJsonProps) => {
  if (typeof json !== "object" || json === null) {
    return null;
  }

  const isRpcResponse = Object.keys(json as AnyObject)[0] === "jsonrpc";

  const getItemSizeLabel = (items: unknown[]) => {
    const size = items.length;
    return size === 1 ? `${size} item` : `${size} items`;
  };

  const ItemCount = ({ itemList }: { itemList: unknown[] }) => (
    <div style={styles.expandSize}>{getItemSizeLabel(itemList)}</div>
  );

  const Collapsible = ({
    itemKey,
    itemList,
    char,
    children,
  }: {
    itemKey?: string;
    itemList: unknown[];
    char: Char;
    children: React.ReactNode;
  }) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const customRender =
      itemKey && customKeyRenderer
        ? customKeyRenderer(children, itemKey)
        : null;

    return (
      <div style={styles.nested}>
        <div
          style={{
            ...styles.inline,
            ...(isCollapsible ? styles.clickable : {}),
          }}
          {...(isCollapsible
            ? {
                onClick: () => setIsExpanded(!isExpanded),
              }
            : {})}
        >
          {isCollapsible ? (
            <div style={styles.expandIcon}>
              <div style={styles.expandIconSvg}>
                {isExpanded ? <Icon.MinusSquare /> : <Icon.PlusSquare />}
              </div>
            </div>
          ) : null}
          {itemKey ? <Key>{itemKey}</Key> : null}
          <Bracket char={char} isCollapsed={!isExpanded} />
          {isCollapsible ? <ItemCount itemList={itemList} /> : null}
          {customRender}
        </div>
        {isExpanded ? (
          <div>
            {children}
            <div>
              <Bracket char={getClosingChar(char)} />
              <Comma />
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const render = (
    item: unknown,
    parentKey?: string,
  ): React.ReactElement | null => {
    const renderValue = (
      value: unknown,
      key: string,
      valueParentKey?: string,
    ) => {
      const custom = customKeyValueLinkMap?.[key];

      if (custom) {
        if (
          custom.condition &&
          typeof value === "string" &&
          !custom.condition(value, valueParentKey, isRpcResponse)
        ) {
          return render(value, key);
        }

        if (typeof value === "string") {
          const href = custom.getHref(value, key);

          return (
            <Link
              href={href || value}
              {...(href ? { target: "_blank" } : {})}
              isUnderline
            >
              {custom.text || value}
            </Link>
          );
        }
      }

      const customValue = customValueRenderer
        ? customValueRenderer(value, key, valueParentKey)
        : null;

      return customValue ?? render(value, key);
    };

    switch (typeof item) {
      case "object":
        if (item === null) {
          return (
            <Value>
              null
              <Comma />
            </Value>
          );
        }

        return (
          <React.Fragment key={parentKey}>
            {Object.entries(item as object).map(([key, value]) => {
              const keyProp = parentKey ? `${parentKey}-${key}` : key;

              if (typeof value === "object") {
                if (value === null) {
                  return (
                    <div key={keyProp} style={styles.inline}>
                      <div style={styles.nested}>
                        <Key>{key}</Key>
                      </div>
                      <Value>
                        null
                        <Comma />
                      </Value>
                    </div>
                  );
                }

                if (Array.isArray(value)) {
                  if (value.length === 0) {
                    return (
                      <div key={keyProp} style={styles.inline}>
                        <div style={styles.nested}>
                          <Key>{key}</Key>
                        </div>
                        <Value>
                          {`[]`}
                          <Comma />
                        </Value>
                      </div>
                    );
                  }

                  return (
                    <Collapsible
                      key={keyProp}
                      itemKey={key}
                      itemList={value}
                      char="["
                    >
                      {value.map((v, index) => {
                        if (typeof v === "object") {
                          if (v === null) {
                            return (
                              <div
                                key={`${keyProp}-${index}`}
                                style={styles.nested}
                              >
                                <Value>
                                  null
                                  <Comma />
                                </Value>
                              </div>
                            );
                          }

                          if (Array.isArray(v)) {
                            return (
                              <Collapsible
                                key={`${keyProp}-${index}`}
                                itemList={Object.keys(v)}
                                char="["
                              >
                                {v.map((v2, nestedIndex) => (
                                  <React.Fragment key={nestedIndex}>
                                    {render(v2)}
                                  </React.Fragment>
                                ))}
                              </Collapsible>
                            );
                          }

                          return (
                            <Collapsible
                              key={`${keyProp}-${index}`}
                              itemList={Object.keys(v as AnyObject)}
                              char="{"
                            >
                              {render(v, key)}
                            </Collapsible>
                          );
                        }

                        return (
                          <React.Fragment key={`${keyProp}-${index}`}>
                            {render(v, key)}
                          </React.Fragment>
                        );
                      })}
                    </Collapsible>
                  );
                }

                if (value && isEmptyObject(value as AnyObject)) {
                  return (
                    <div key={keyProp} style={styles.inline}>
                      <div style={styles.nested}>
                        <Key>{key}</Key>
                      </div>
                      <Value>
                        {`{}`}
                        <Comma />
                      </Value>
                    </div>
                  );
                }

                return (
                  <Collapsible
                    key={keyProp}
                    itemKey={key}
                    itemList={Object.keys(value as AnyObject)}
                    char="{"
                  >
                    {render(value, key)}
                  </Collapsible>
                );
              }

              return (
                <div key={keyProp} style={styles.inline}>
                  <div style={styles.nested}>
                    <Key>{key}</Key>
                  </div>
                  {renderValue(value, key, parentKey)}
                </div>
              );
            })}
          </React.Fragment>
        );

      case "string":
        return renderStringValue({
          item,
          parentKey,
          customValueRenderer,
        });

      case "function":
        return (
          <Value>
            {`${JSON.stringify(item)}`}
            <Comma />
          </Value>
        );

      default:
        return (
          <Value>
            <ValueType type={typeof item}>{`${item as string}`}</ValueType>
            <Comma />
          </Value>
        );
    }
  };

  if (isLoading) {
    return (
      <div style={styles.loaderContainer}>
        <Loader />
      </div>
    );
  }

  return (
    <div style={styles.prettyJson}>
      <Bracket char="{" />
      {render(json)}
      <Bracket char="}" />
    </div>
  );
};

const Key = ({ children }: { children: string }) => (
  <div style={styles.key}>
    {`"${children}"`}
    <Colon />
  </div>
);

const Value = ({
  children,
  customStyle,
}: {
  children: React.ReactNode;
  customStyle?: React.CSSProperties;
}) => <div style={{ ...styles.defaultColor, ...customStyle }}>{children}</div>;

const ValueType = ({
  children,
  type,
}: {
  children: React.ReactNode;
  type: string;
}) => {
  const getTypeStyle = () => {
    switch (type) {
      case "string":
        return styles.valueString;
      case "number":
      case "bigint":
        return styles.valueNumber;
      case "boolean":
        return styles.valueBoolean;
      default:
        return styles.defaultColor;
    }
  };

  return <span style={getTypeStyle()}>{children}</span>;
};

const Quotes = ({ isVisible = true }: { isVisible?: boolean }) =>
  isVisible ? <span style={styles.defaultColor}>{'"'}</span> : null;

const Colon = () => <span style={styles.defaultColor}>{":"}</span>;

const Comma = () => <span style={styles.defaultColor}>{","}</span>;

const Bracket = ({
  char,
  children,
  isCollapsed,
}: {
  char: Char;
  children?: React.ReactNode;
  isCollapsed?: boolean;
}) => (
  <span style={styles.defaultColor}>
    {char}
    {children}
    {isCollapsed ? `...${getClosingChar(char)}` : null}
  </span>
);

const getClosingChar = (char: Char) => (char === "[" ? "]" : "}");

const renderStringValue = ({
  item,
  customStyle,
  itemType,
  parentKey,
  customValueRenderer,
}: {
  item: string;
  customStyle?: React.CSSProperties;
  itemType?: "number" | "string";
  parentKey?: string;
  customValueRenderer?: (
    item: unknown,
    key: string,
    parentKey?: string,
  ) => React.ReactNode | null;
}) => {
  const customValue =
    customValueRenderer && customValueRenderer(item, "", parentKey);

  if (customValue) {
    return (
      <Value customStyle={customStyle}>
        <>{customValue}</>
        <Comma />
      </Value>
    );
  }

  const type = itemType ?? "string";
  const value = item;
  const valueStyle = {
    ...customStyle,
  };

  return (
    <Value customStyle={valueStyle}>
      {isValidUrl(item) ? (
        <>
          <Quotes />
          <Link href={item} isUnderline>
            {item}
          </Link>
          <Quotes />
        </>
      ) : (
        <>
          <Quotes isVisible={type === "string"} />
          <ValueType type={type}>{value}</ValueType>
          <Quotes isVisible={type === "string"} />
        </>
      )}
      <Comma />
    </Value>
  );
};

PrettyJson.renderStringValue = renderStringValue;